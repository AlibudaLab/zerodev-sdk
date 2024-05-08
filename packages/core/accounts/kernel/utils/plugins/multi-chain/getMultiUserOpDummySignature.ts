import MerkleTree from "merkletreejs"
import { type UserOperation, getUserOperationHash } from "permissionless"
import type {
    EntryPoint,
    GetEntryPointVersion
} from "permissionless/types/entrypoint"
import { type Hex, concatHex, encodeAbiParameters, keccak256 } from "viem"

export const getMultiUserOpDummySignature = <entryPoint extends EntryPoint>(
    userOperation: UserOperation<GetEntryPointVersion<entryPoint>>,
    numOfUserOps: number,
    entryPoint: entryPoint,
    chainId: number
): Hex => {
    const userOpHash = getUserOperationHash<entryPoint>({
        userOperation,
        entryPoint,
        chainId
    })

    const dummyUserOpHash = `0x${"a".repeat(64)}`
    const dummyLeaves = Array(numOfUserOps - 1).fill(dummyUserOpHash)

    const leaves = [userOpHash, ...dummyLeaves]

    const merkleTree = new MerkleTree(leaves, keccak256, {
        sortPairs: true
    })

    const merkleRoot = merkleTree.getHexRoot() as Hex
    const merkleProof = merkleTree.getHexProof(userOpHash) as Hex[]

    const dummyEcdsaSig =
        "0xfffffffffffffffffffffffffffffff0000000000000000000000000000000007aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1c"

    const encodedMerkleProof = encodeAbiParameters(
        [
            { name: "dummyUserOpHash", type: "bytes32" },
            { name: "proof", type: "bytes32[]" }
        ],
        [userOpHash, merkleProof]
    )

    const finalDummySig = concatHex([
        dummyEcdsaSig,
        merkleRoot,
        encodedMerkleProof
    ])

    return finalDummySig
}
