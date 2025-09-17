import { kymn } from "../index";
import { ethers, type TransactionRequest } from 'ethers';
import abi from "../abis/test.sol.abi.json";


async function rewardWinners(
  contractAddress: string,
  rpcUrl: string,
  chainId: number,
  keyId: string,
  functionName: string,
  args: any[],
  gas: bigint,
) {
  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl);

    const k = new kymn();

    const walletAddress = await k.deriveEVMAddress(keyId);

    const nonce = await provider.getTransactionCount(walletAddress, 'pending');
    const feeData = await provider.getFeeData();
    const bumpedMaxFeePerGas = (feeData.maxFeePerGas! * 120n) / 100n;
    const bumpedMaxPriorityFeePerGas = (feeData.maxPriorityFeePerGas! * 120n) / 100n;

    const iface = new ethers.Interface(abi);
    const data = iface.encodeFunctionData(functionName, args);

    const tx: TransactionRequest = {
      to: contractAddress,
      data,
      nonce,
      //value: 0n,
      maxFeePerGas: bumpedMaxFeePerGas,
      maxPriorityFeePerGas: bumpedMaxPriorityFeePerGas,
      gasLimit: (gas * 120n) / 100n,
    }

    const signedTx = await k.signTransaction(keyId, tx, chainId);
    const txResponse = await provider.broadcastTransaction(signedTx);
    const receipt = await txResponse.wait();

    return receipt;
  } catch (error) {
    console.error('Error calling rewardYapWinners:', error);
    throw error; 
  }
}

