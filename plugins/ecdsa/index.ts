import type { KernelValidator } from "@zerodev/sdk/types"
import { signerToEcdsaValidator } from "./toECDSAValidatorPlugin.js"

export { signerToEcdsaValidator, type KernelValidator }

export const ECDSA_VALIDATOR_ADDRESS_V06 =
    "0xd9AB5096a832b9ce79914329DAEE236f8Eea0390"
export const ECDSA_VALIDATOR_ADDRESS_V07 = "0xa4deD2e899B52DF88d8A47Ed1782E7f3E72e010F"