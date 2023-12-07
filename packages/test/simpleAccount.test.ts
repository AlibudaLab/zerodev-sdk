import { beforeAll, describe, expect, test } from "bun:test"
import dotenv from "dotenv"
import { SignTransactionNotSupportedBySmartAccount } from "@zerodev/core/accounts"
import { Address, Hex, decodeEventLog, getContract, zeroAddress } from "viem"
import { EntryPointAbi } from "./abis/EntryPoint.js"
import { GreeterAbi, GreeterBytecode } from "./abis/Greeter.js"
import {
    getBundlerClient,
    getEntryPoint,
    getPimlicoPaymasterClient,
    getPublicClient,
    getSignerToSimpleSmartAccount,
    getSmartAccountClient,
    waitForNonceUpdate
} from "./utils.js"

dotenv.config()

let testPrivateKey: Hex
let factoryAddress: Address

beforeAll(() => {
    if (!process.env.PIMLICO_API_KEY) {
        throw new Error("PIMLICO_API_KEY environment variable not set")
    }
    if (!process.env.STACKUP_API_KEY) {
        throw new Error("STACKUP_API_KEY environment variable not set")
    }
    if (!process.env.FACTORY_ADDRESS) {
        throw new Error("FACTORY_ADDRESS environment variable not set")
    }
    if (!process.env.TEST_PRIVATE_KEY) {
        throw new Error("TEST_PRIVATE_KEY environment variable not set")
    }
    if (!process.env.RPC_URL) {
        throw new Error("RPC_URL environment variable not set")
    }
    if (!process.env.ENTRYPOINT_ADDRESS) {
        throw new Error("ENTRYPOINT_ADDRESS environment variable not set")
    }

    if (!process.env.GREETER_ADDRESS) {
        throw new Error("ENTRYPOINT_ADDRESS environment variable not set")
    }
    testPrivateKey = process.env.TEST_PRIVATE_KEY as Hex
    factoryAddress = process.env.FACTORY_ADDRESS as Address
})

describe("Simple Account", () => {
    test("Simple Account address", async () => {
        const simpleSmartAccount = await getSignerToSimpleSmartAccount()

        expect(simpleSmartAccount.address).toBeString()
        expect(simpleSmartAccount.address).toHaveLength(42)
        expect(simpleSmartAccount.address).toMatch(/^0x[0-9a-fA-F]{40}$/)

        expect(async () => {
            await simpleSmartAccount.signTransaction({
                to: zeroAddress,
                value: 0n,
                data: "0x"
            })
        }).toThrow(new SignTransactionNotSupportedBySmartAccount())
    })

    test("Smart account client signMessage", async () => {
        const smartAccountClient = await getSmartAccountClient()

        const response = await smartAccountClient.signMessage({
            message: "hello world"
        })

        expect(response).toBeString()
        expect(response).toHaveLength(132)
        expect(response).toMatch(/^0x[0-9a-fA-F]{130}$/)
    })

    test("Smart account client signTypedData", async () => {
        const smartAccountClient = await getSmartAccountClient()

        const response = await smartAccountClient.signTypedData({
            domain: {
                chainId: 1,
                name: "Test",
                verifyingContract: zeroAddress
            },
            primaryType: "Test",
            types: {
                Test: [
                    {
                        name: "test",
                        type: "string"
                    }
                ]
            },
            message: {
                test: "hello world"
            }
        })

        expect(response).toBeString()
        expect(response).toHaveLength(132)
        expect(response).toMatch(/^0x[0-9a-fA-F]{130}$/)
    })

    test("smart account client deploy contract", async () => {
        const smartAccountClient = await getSmartAccountClient()

        expect(async () => {
            await smartAccountClient.deployContract({
                abi: GreeterAbi,
                bytecode: GreeterBytecode
            })
        }).toThrow("Simple account doesn't support account deployment")
    })

    test("Smart account client send multiple transactions", async () => {
        const smartAccountClient = await getSmartAccountClient()
        const response = await smartAccountClient.sendTransactions({
            transactions: [
                {
                    to: zeroAddress,
                    value: 0n,
                    data: "0x"
                },
                {
                    to: zeroAddress,
                    value: 0n,
                    data: "0x"
                }
            ]
        })
        expect(response).toBeString()
        expect(response).toHaveLength(66)
        expect(response).toMatch(/^0x[0-9a-fA-F]{64}$/)
        await waitForNonceUpdate()
    }, 1000000)

    test("Smart account write contract", async () => {
        const greeterContract = getContract({
            abi: GreeterAbi,
            address: process.env.GREETER_ADDRESS as Address,
            publicClient: await getPublicClient(),
            walletClient: await getSmartAccountClient()
        })

        const oldGreet = await greeterContract.read.greet()

        expect(oldGreet).toBeString()

        const txHash = await greeterContract.write.setGreeting(["hello world"])

        expect(txHash).toBeString()
        expect(txHash).toHaveLength(66)

        const newGreet = await greeterContract.read.greet()

        expect(newGreet).toBeString()
        expect(newGreet).toEqual("hello world")
        await waitForNonceUpdate()
    }, 1000000)

    test("Smart account client send transaction", async () => {
        const smartAccountClient = await getSmartAccountClient()
        const response = await smartAccountClient.sendTransaction({
            to: zeroAddress,
            value: 0n,
            data: "0x"
        })
        expect(response).toBeString()
        expect(response).toHaveLength(66)
        expect(response).toMatch(/^0x[0-9a-fA-F]{64}$/)
        await waitForNonceUpdate()
    }, 1000000)

    test("smart account client send Transaction with paymaster", async () => {
        const publicClient = await getPublicClient()

        const bundlerClient = getBundlerClient()

        const smartAccountClient = await getSmartAccountClient({
            sponsorUserOperation: async ({
                entryPoint: _entryPoint,
                userOperation
            }): Promise<{
                paymasterAndData: Hex
                preVerificationGas: bigint
                verificationGasLimit: bigint
                callGasLimit: bigint
            }> => {
                const pimlicoPaymaster = getPimlicoPaymasterClient()
                return pimlicoPaymaster.sponsorUserOperation({
                    userOperation,
                    entryPoint: getEntryPoint()
                })
            }
        })

        const response = await smartAccountClient.sendTransaction({
            to: zeroAddress,
            value: 0n,
            data: "0x"
        })

        expect(response).toBeString()
        expect(response).toHaveLength(66)
        expect(response).toMatch(/^0x[0-9a-fA-F]{64}$/)

        const transactionReceipt = await publicClient.waitForTransactionReceipt(
            {
                hash: response
            }
        )

        let eventFound = false

        for (const log of transactionReceipt.logs) {
            const event = decodeEventLog({
                abi: EntryPointAbi,
                ...log
            })
            if (event.eventName === "UserOperationEvent") {
                eventFound = true
                const userOperation =
                    await bundlerClient.getUserOperationByHash({
                        hash: event.args.userOpHash
                    })
                expect(userOperation?.userOperation.paymasterAndData).not.toBe(
                    "0x"
                )
            }
        }

        expect(eventFound).toBeTrue()
        await waitForNonceUpdate()
    }, 1000000)

    test("smart account client send multiple Transactions with paymaster", async () => {
        const publicClient = await getPublicClient()

        const bundlerClient = getBundlerClient()

        const smartAccountClient = await getSmartAccountClient({
            sponsorUserOperation: async ({
                entryPoint: _entryPoint,
                userOperation
            }): Promise<{
                paymasterAndData: Hex
                preVerificationGas: bigint
                verificationGasLimit: bigint
                callGasLimit: bigint
            }> => {
                const pimlicoPaymaster = getPimlicoPaymasterClient()
                return pimlicoPaymaster.sponsorUserOperation({
                    userOperation,
                    entryPoint: getEntryPoint()
                })
            }
        })

        const response = await smartAccountClient.sendTransactions({
            transactions: [
                {
                    to: zeroAddress,
                    value: 0n,
                    data: "0x"
                },
                {
                    to: zeroAddress,
                    value: 0n,
                    data: "0x"
                }
            ]
        })

        expect(response).toBeString()
        expect(response).toHaveLength(66)
        expect(response).toMatch(/^0x[0-9a-fA-F]{64}$/)

        const transactionReceipt = await publicClient.waitForTransactionReceipt(
            {
                hash: response
            }
        )

        let eventFound = false

        for (const log of transactionReceipt.logs) {
            const event = decodeEventLog({
                abi: EntryPointAbi,
                ...log
            })
            if (event.eventName === "UserOperationEvent") {
                eventFound = true
                const userOperation =
                    await bundlerClient.getUserOperationByHash({
                        hash: event.args.userOpHash
                    })
                expect(userOperation?.userOperation.paymasterAndData).not.toBe(
                    "0x"
                )
            }
        }

        expect(eventFound).toBeTrue()
        await waitForNonceUpdate()
    }, 1000000)
})
