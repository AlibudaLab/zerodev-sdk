import type { EntryPoint } from "permissionless/types"
import type { GetEntryPointVersion } from "permissionless/types/entrypoint"
import type {
    UserOperation,
    UserOperationWithBigIntAsHex
} from "permissionless/types/userOperation"
import { type Address, type Hex, type LocalAccount } from "viem"
import type { PartialBy } from "viem/types/utils"
import { VALIDATOR_TYPE } from "../constants.js"
export type ZeroDevPaymasterRpcSchema<entryPoint extends EntryPoint> = [
    {
        Method: "zd_sponsorUserOperation"
        Parameters: [
            {
                chainId: number
                userOp: GetEntryPointVersion<entryPoint> extends "v0.6"
                    ? PartialBy<
                          UserOperationWithBigIntAsHex<"v0.6">,
                          | "callGasLimit"
                          | "preVerificationGas"
                          | "verificationGasLimit"
                      >
                    : PartialBy<
                          UserOperationWithBigIntAsHex<"v0.7">,
                          | "callGasLimit"
                          | "preVerificationGas"
                          | "verificationGasLimit"
                          | "paymasterVerificationGasLimit"
                          | "paymasterPostOpGasLimit"
                      >
                entryPointAddress: Address
                gasTokenData?: {
                    tokenAddress: Hex
                }
                shouldOverrideFee?: boolean
                manualGasEstimation?: boolean
                shouldConsume?: boolean
            }
        ]
        ReturnType: GetEntryPointVersion<entryPoint> extends "v0.6"
            ? {
                  paymasterAndData: Hex
                  preVerificationGas: Hex
                  verificationGasLimit: Hex
                  callGasLimit: Hex
                  maxFeePerGas: Hex
                  maxPriorityFeePerGas: Hex
                  paymaster?: never
                  paymasterVerificationGasLimit?: never
                  paymasterPostOpGasLimit?: never
                  paymasterData?: never
              }
            : {
                  preVerificationGas: Hex
                  verificationGasLimit: Hex
                  callGasLimit: Hex
                  paymaster: Address
                  paymasterVerificationGasLimit: Hex
                  paymasterPostOpGasLimit: Hex
                  paymasterData: Hex
                  paymasterAndData?: never
              }
    },
    {
        Method: "zd_pm_accounts"
        Parameters: [
            {
                chainId: number
                entryPointAddress: Address
            }
        ]
        ReturnType: Address[]
    },
    {
        Method: "stackup_getERC20TokenQuotes"
        Parameters: [
            {
                chainId: number
                userOp: UserOperationWithBigIntAsHex<"v0.6">
                entryPointAddress: Address
                tokenAddress: Address
            }
        ]
        ReturnType: {
            maxGasCostToken: string
            tokenDecimals: string
        }
    }
]

export type ValidatorType = Extract<
    keyof typeof VALIDATOR_TYPE,
    "PERMISSION" | "SECONDARY"
>

export type KernelValidator<
    entryPoint extends EntryPoint,
    Name extends string = string
> = LocalAccount<Name> & {
    validatorType: ValidatorType
    getNonceKey: (accountAddress?: Address) => Promise<bigint>
    getDummySignature(
        userOperation: UserOperation<GetEntryPointVersion<entryPoint>>,
        pluginEnableSignature?: Hex
    ): Promise<Hex>
    signUserOperation: (
        userOperation: UserOperation<GetEntryPointVersion<entryPoint>>,
        pluginEnableSignature?: Hex
    ) => Promise<Hex>
    getEnableData(accountAddress?: Address): Promise<Hex>
    isEnabled(accountAddress: Address, selector: Hex): Promise<boolean>
    getIdentifier: () => Hex
}

export type ValidatorInitData = {
    validatorAddress: Address
    enableData: Hex
}

export type KernelPluginManager<entryPoint extends EntryPoint> =
    KernelValidator<entryPoint> & {
        getPluginEnableSignature(accountAddress: Address): Promise<Hex>
        getValidatorInitData(): Promise<ValidatorInitData>
        getExecutorData(): Action
        getValidityData(): PluginValidityData
        getIdentifier(isSudo?: boolean): Hex
    }

export type KernelPluginManagerParams<entryPoint extends EntryPoint> = {
    sudo?: KernelValidator<entryPoint>
    regular?: KernelValidator<entryPoint>
    pluginEnableSignature?: Hex
    validatorInitData?: ValidatorInitData
    executorData?: Action
    entryPoint: entryPoint
    kernelVersion?: string
} & Partial<PluginValidityData>

export type Action = {
    executor: Address
    selector: Hex
}

export type PluginValidityData = {
    validUntil: number
    validAfter: number
}

export enum ValidatorMode {
    sudo = "0x00000000",
    plugin = "0x00000001",
    enable = "0x00000002"
}

export type CallType = "call" | "delegatecall"

export type KernelEncodeCallDataArgs =
    | {
          to: Address
          value: bigint
          data: Hex
          callType: CallType | undefined
      }
    | {
          to: Address
          value: bigint
          data: Hex
          callType: CallType | undefined
      }[]

export type Execution = {
    target: Address
    value: bigint
    callData: Hex
}
