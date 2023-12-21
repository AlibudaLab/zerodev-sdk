import {
  type Account,
  type Address,
  type Chain,
  type Client,
  type Hex,
  type Transport,
  concatHex,
  encodeFunctionData,
  isAddressEqual,
} from "viem";
import { toAccount } from "viem/accounts";
import {
  getBytecode,
  getChainId,
  readContract,
  signMessage,
  signTypedData,
} from "viem/actions";
import { getAccountNonce } from "../../actions/public/getAccountNonce.js";
import { getSenderAddress } from "../../actions/public/getSenderAddress.js";
import { getUserOperationHash } from "../../utils/getUserOperationHash.js";
import type { SmartAccount } from "../types.js";
import {
  SignTransactionNotSupportedBySmartAccount,
  type SmartAccountSigner,
} from "../types.js";
import { KernelExecuteAbi, KernelInitAbi } from "./abi/KernelAccountAbi.js";

export type KernelSmartAccount<
  transport extends Transport = Transport,
  chain extends Chain | undefined = Chain | undefined
> = Omit<SmartAccount<"kernelSmartAccount", transport, chain>, "getDummySignature"> & {
  getDummySignature(calldata?: Hex): Promise<Hex>
};

/**
 * The account creation ABI for a kernel smart account (from the KernelFactory)
 */
const createAccountAbi = [
  {
    inputs: [
      {
        internalType: "address",
        name: "_implementation",
        type: "address",
      },
      {
        internalType: "bytes",
        name: "_data",
        type: "bytes",
      },
      {
        internalType: "uint256",
        name: "_index",
        type: "uint256",
      },
    ],
    name: "createAccount",
    outputs: [
      {
        internalType: "address",
        name: "proxy",
        type: "address",
      },
    ],
    stateMutability: "payable",
    type: "function",
  },
] as const;

/**
 * Default addresses for kernel smart account
 */
export const KERNEL_ADDRESSES: {
  ECDSA_VALIDATOR: Address;
  ACCOUNT_V2_2_LOGIC: Address;
  FACTORY_ADDRESS: Address;
  KILL_SWITCH_VALIDATOR: Address;
  KILL_SWITCH_ACTION: Address;
  ERC165_SESSION_KEY_VALIDATOR: Address;
  SESSION_KEY_VALIDATOR: Address;
  RECOVERY_VALIDATOR: Address;
  ENTRYPOINT_ADDRESS: Address;
} = {
  ECDSA_VALIDATOR: "0xd9AB5096a832b9ce79914329DAEE236f8Eea0390",
  ACCOUNT_V2_2_LOGIC: "0x0DA6a956B9488eD4dd761E59f52FDc6c8068E6B5",
  FACTORY_ADDRESS: "0x5de4839a76cf55d0c90e2061ef4386d962E15ae3",
  KILL_SWITCH_VALIDATOR: "0x7393A7dA58CCfFb78f52adb09705BE6E20F704BC",
  KILL_SWITCH_ACTION: "0x3f38e479304c7F18F988269a1bDa7d646bd48243",
  ERC165_SESSION_KEY_VALIDATOR: "0xe149290800De29D4b0BF9dB82c508255D81902E6",
  SESSION_KEY_VALIDATOR: "0xB8E3c4bEaACAd06f6092793012DA4a8cB23D6123",
  RECOVERY_VALIDATOR: "0x4fd47D861c349bD49DC61341a922cb72F9dF7E8d",
  ENTRYPOINT_ADDRESS: "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789",
};

/**
 * Get the account initialization code for a kernel smart account
 * @param owner
 * @param index
 * @param factoryAddress
 * @param accountLogicAddress
 * @param ecdsaValidatorAddress
 */
const getAccountInitCode = async ({
  owner,
  index,
  factoryAddress,
  accountLogicAddress,
  ecdsaValidatorAddress,
}: {
  owner: Address;
  index: bigint;
  factoryAddress: Address;
  accountLogicAddress: Address;
  ecdsaValidatorAddress: Address;
}): Promise<Hex> => {
  if (!owner) throw new Error("Owner account not found");

  // Build the account initialization data
  const initialisationData = encodeFunctionData({
    abi: KernelInitAbi,
    functionName: "initialize",
    args: [ecdsaValidatorAddress, owner],
  });

  // Build the account init code
  return concatHex([
    factoryAddress,
    encodeFunctionData({
      abi: createAccountAbi,
      functionName: "createAccount",
      args: [accountLogicAddress, initialisationData, index],
    }) as Hex,
  ]);
};

/**
 * Check the validity of an existing account address, or fetch the pre-deterministic account address for a kernel smart wallet
 * @param client
 * @param owner
 * @param entryPoint
 * @param ecdsaValidatorAddress
 * @param initCodeProvider
 * @param deployedAccountAddress
 */
const getAccountAddress = async <
  TTransport extends Transport = Transport,
  TChain extends Chain | undefined = Chain | undefined
>({
  client,
  owner,
  entryPoint,
  initCodeProvider,
  ecdsaValidatorAddress,
  deployedAccountAddress,
}: {
  client: Client<TTransport, TChain>;
  owner: Address;
  initCodeProvider: () => Promise<Hex>;
  entryPoint: Address;
  ecdsaValidatorAddress: Address;
  deployedAccountAddress?: Address;
}): Promise<Address> => {
  // If we got an already deployed account, ensure it's well deployed, and the validator & signer are correct
  if (deployedAccountAddress !== undefined) {
    // Get the owner of the deployed account, ensure it's the same as the owner given in params
    const deployedAccountOwner = await readContract(client, {
      address: ecdsaValidatorAddress,
      abi: [
        {
          inputs: [
            {
              internalType: "address",
              name: "",
              type: "address",
            },
          ],
          name: "ecdsaValidatorStorage",
          outputs: [
            {
              internalType: "address",
              name: "owner",
              type: "address",
            },
          ],
          stateMutability: "view",
          type: "function",
        },
      ],
      functionName: "ecdsaValidatorStorage",
      args: [deployedAccountAddress],
    });

    // Ensure the address match
    if (!isAddressEqual(deployedAccountOwner, owner)) {
      throw new Error("Invalid owner for the already deployed account");
    }

    // If ok, return the address
    return deployedAccountAddress;
  }

  // Find the init code for this account
  const initCode = await initCodeProvider();

  // Get the sender address based on the init code
  return getSenderAddress(client, {
    initCode,
    entryPoint,
  });
};

/**
 * Build a kernel smart account from a private key, that use the ECDSA signer behind the scene
 * @param client
 * @param privateKey
 * @param entryPoint
 * @param index
 * @param factoryAddress
 * @param accountLogicAddress
 * @param ecdsaValidatorAddress
 * @param deployedAccountAddress
 */
export async function signerToEcdsaKernelSmartAccount<
  TTransport extends Transport = Transport,
  TChain extends Chain | undefined = Chain | undefined
>(
  client: Client<TTransport, TChain>,
  {
    signer,
    entryPoint,
    index = 0n,
    factoryAddress = KERNEL_ADDRESSES.FACTORY_ADDRESS,
    accountLogicAddress = KERNEL_ADDRESSES.ACCOUNT_V2_2_LOGIC,
    ecdsaValidatorAddress = KERNEL_ADDRESSES.ECDSA_VALIDATOR,
    deployedAccountAddress,
  }: {
    signer: SmartAccountSigner;
    entryPoint: Address;
    index?: bigint;
    factoryAddress?: Address;
    accountLogicAddress?: Address;
    ecdsaValidatorAddress?: Address;
    deployedAccountAddress?: Address;
  }
): Promise<KernelSmartAccount<TTransport, TChain>> {
  // Get the private key related account
  const viemSigner: Account =
    signer.type === "local"
      ? ({
          ...signer,
          signTransaction: (_, __) => {
            throw new SignTransactionNotSupportedBySmartAccount();
          },
        } as Account)
      : (signer as Account);

  // Helper to generate the init code for the smart account
  const generateInitCode = () =>
    getAccountInitCode({
      owner: viemSigner.address,
      index,
      factoryAddress,
      accountLogicAddress,
      ecdsaValidatorAddress,
    });

  // Fetch account address and chain id
  const [accountAddress, chainId] = await Promise.all([
    getAccountAddress<TTransport, TChain>({
      client,
      entryPoint,
      owner: viemSigner.address,
      ecdsaValidatorAddress,
      initCodeProvider: generateInitCode,
      deployedAccountAddress,
    }),
    getChainId(client),
  ]);

  if (!accountAddress) throw new Error("Account address not found");

  // Build the EOA Signer
  const account = toAccount({
    address: accountAddress,
    async signMessage({ message }) {
      return signMessage(client, { account: viemSigner, message });
    },
    async signTransaction(_, __) {
      throw new SignTransactionNotSupportedBySmartAccount();
    },
    async signTypedData(typedData) {
      return signTypedData(client, { account: viemSigner, ...typedData });
    },
  });

  return {
    ...account,
    client: client,
    publicKey: accountAddress,
    entryPoint: entryPoint,
    source: "kernelSmartAccount",

    // Get the nonce of the smart account
    async getNonce() {
      return getAccountNonce(client, {
        sender: accountAddress,
        entryPoint: entryPoint,
      });
    },

    // Sign a user operation
    async signUserOperation(userOperation) {
      const hash = getUserOperationHash({
        userOperation: {
          ...userOperation,
          signature: "0x",
        },
        entryPoint: entryPoint,
        chainId: chainId,
      });
      const signature = await signMessage(client, {
        account: viemSigner,
        message: { raw: hash },
      });
      // Always use the sudo mode, since we will use external paymaster
      return concatHex(["0x00000000", signature]);
    },

    // Encode the init code
    async getInitCode() {
      const contractCode = await getBytecode(client, {
        address: accountAddress,
      });

      if ((contractCode?.length ?? 0) > 2) return "0x";

      return generateInitCode();
    },

    // Encode the deploy call data
    async encodeDeployCallData(_) {
      throw new Error("Simple account doesn't support account deployment");
    },

    // Encode a call
    async encodeCallData(_tx) {
      if (Array.isArray(_tx)) {
        // Encode a batched call
        return encodeFunctionData({
          abi: KernelExecuteAbi,
          functionName: "executeBatch",
          args: [
            _tx.map((tx) => ({
              to: tx.to,
              value: tx.value,
              data: tx.data,
            })),
          ],
        });
      } else {
        // Encode a simple call
        return encodeFunctionData({
          abi: KernelExecuteAbi,
          functionName: "execute",
          args: [_tx.to, _tx.value, _tx.data, 0],
        });
      }
    },

    // Get simple dummy signature
    async getDummySignature(_calldata?: Hex) {
      return "0x00000000fffffffffffffffffffffffffffffff0000000000000000000000000000000007aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1c";
    },
  };
}
