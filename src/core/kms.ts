import {
  KMSClient,
  CreateKeyCommand,
  GetPublicKeyCommand,
  SignCommand,
} from "@aws-sdk/client-kms";
import * as asn1js from "asn1js";
import {
  Transaction,
  keccak256,
  getAddress,
  Signature,
  recoverAddress,
  resolveAddress,
  toBeHex,
  hashMessage,
  type TransactionRequest,
} from "ethers";

export class kymn {
  private client: KMSClient;
  private readonly SECP256K1_N = BigInt(
    "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141"
  );
  private readonly SECP256K1_N_DIV_2 = this.SECP256K1_N / 2n;

  constructor(credentials: {
    region: string;
    accessKey: string;
    accessSecret: string;
  }) {
    this.client = new KMSClient({
      credentials: {
        accessKeyId: credentials.accessKey,
        secretAccessKey: credentials.accessSecret,
      },
      region: credentials.region,
    });
  }

  async createKey() {
    const command = new CreateKeyCommand({
      KeySpec: "ECC_SECG_P256K1", // secp256k1 for EVM
      KeyUsage: "SIGN_VERIFY", // For signing txs/messages
      Description: "EVM Wallet Key",
    });

    const response = await this.client.send(command);
    const keyId = response.KeyMetadata?.KeyId;
    return keyId;
  }

  async getPublicKey(keyId: string) {
    const command = new GetPublicKeyCommand({ KeyId: keyId });
    const response = await this.client.send(command);
    const publicKey = response.PublicKey;
    return publicKey;
  }

  async deriveEVMAddress(keyId: string) {
    try {
      const publicKey = await this.getPublicKey(keyId);
      if (!publicKey) throw new Error("No public key");

      const asn1 = asn1js.fromBER(Buffer.from(publicKey).buffer);
      if (asn1.result.error)
        throw new Error(`ASN.1 parsing error: ${asn1.result.error}`);

      const subjectPublicKeyInfo = asn1.result;
      if (!(subjectPublicKeyInfo instanceof asn1js.Sequence)) {
        throw new Error("Invalid SubjectPublicKeyInfo structure");
      }

      const publicKeyBitString = subjectPublicKeyInfo.valueBlock.value[1];
      if (!(publicKeyBitString instanceof asn1js.BitString)) {
        throw new Error("Invalid public key BitString");
      }

      const pubKeyBytes = publicKeyBitString.valueBlock.valueHexView; // Uncompressed: 0x04 || x || y
      if (pubKeyBytes[0] !== 0x04 || pubKeyBytes.length !== 65) {
        throw new Error("Invalid public key format");
      }

      const pubKeyHash = keccak256(pubKeyBytes.slice(1)); // Skip 0x04
      const address = `0x${pubKeyHash.slice(-40)}`; // Last 20 bytes
      const checksumAddress = getAddress(address);
      return checksumAddress;
    } catch (error) {
      console.error("Error deriving EVM address:", error);
      throw error;
    }
  }

  async signDigest(KeyId: string, digest: Uint8Array) {
    try {
      const command = new SignCommand({
        KeyId,
        Message: digest,
        MessageType: "DIGEST",
        SigningAlgorithm: "ECDSA_SHA_256",
      });
      const response = await this.client.send(command);
      if (!response.Signature) throw new Error("No signature returned");

      const asn1 = asn1js.fromBER(Buffer.from(response.Signature).buffer);
      if (asn1.result.error)
        throw new Error(`ASN.1 parsing error: ${asn1.result.error}`);

      const signature = asn1.result;
      if (!(signature instanceof asn1js.Sequence)) {
        throw new Error("Invalid ECDSA signature structure");
      }

      const [rAsn1, sAsn1] = signature.valueBlock.value;
      if (
        !(rAsn1 instanceof asn1js.Integer) ||
        !(sAsn1 instanceof asn1js.Integer)
      ) {
        throw new Error("Invalid r or s in signature");
      }

      let r = BigInt(
        `0x${Buffer.from(rAsn1.valueBlock.valueHexView).toString("hex")}`
      );
      let s = BigInt(
        `0x${Buffer.from(sAsn1.valueBlock.valueHexView).toString("hex")}`
      );

      // Normalize s to be canonical (s <= n/2)
      if (s > this.SECP256K1_N_DIV_2) {
        s = this.SECP256K1_N - s;
      }

      return { r, s };
    } catch (error) {
      throw error;
    }
  }

  async recoverYParity(
    keyId: string,
    hash: string,
    r: bigint,
    s: bigint
  ): Promise<0 | 1> {
    try {
      const address = await this.deriveEVMAddress(keyId);
      if (!address) {
        throw new Error("Failed to derive address");
      }

      for (let yParity = 0; yParity < 2; yParity++) {
        const sig: Signature = { r, s, yParity } as any;
        if (recoverAddress(hash, sig) === address) {
          return yParity as 0 | 1;
        }
      }
      throw new Error("Invalid signature recovery");
    } catch (error) {
      console.error("Error recovering yParity:", error);
      throw error;
    }
  }

  async signTransaction(
    keyId: string,
    tx: TransactionRequest,
    chainId: number
  ) {
    try {
      const to = tx.to ? await resolveAddress(tx.to) : undefined;
      const resolvedTx: TransactionRequest = {
        ...tx,
        chainId,
        type: 2, // EIP-1559
        to,
      };

      const unsignedTx = Transaction.from(resolvedTx as any);
      const unsignedSerialized = unsignedTx.unsignedSerialized;
      const hash = keccak256(unsignedSerialized);

      const { r, s } = await this.signDigest(
        keyId,
        Buffer.from(hash.slice(2), "hex")
      );
      const yParity = await this.recoverYParity(keyId, hash, r, s);

      const signedTx = Transaction.from({
        ...resolvedTx,
        signature: {
          r: toBeHex(r, 32),
          s: toBeHex(s, 32),
          v: yParity,
        },
      } as any);

      return signedTx.serialized;
    } catch (error) {
      console.error("Error signing transaction:", error);
      throw error;
    }
  }

  async signMessage(keyId: string, message: string) {
    try {
      const hash = hashMessage(message);
      const { r, s } = await this.signDigest(
        keyId,
        Buffer.from(hash.slice(2), "hex")
      );
      const v = (await this.recoverYParity(keyId, hash, r, s)) + 27; // Ethereum v is 27 or 28
      return `0x${r.toString(16).padStart(64, "0")}${s
        .toString(16)
        .padStart(64, "0")}${v.toString(16).padStart(2, "0")}`;
    } catch (error) {
      console.error("Error signing message:", error);
      throw error;
    }
  }
}
