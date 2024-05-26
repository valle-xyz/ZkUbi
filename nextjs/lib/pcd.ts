import {
  booleanToBigInt,
  hexToBigInt,
  numberToBigInt,
  uuidToBigInt
} from '@pcd/util'
import {
  ZKEdDSAEventTicketPCD,
  ZKEdDSAEventTicketPCDClaim
} from '@pcd/zk-eddsa-event-ticket-pcd'
import { sha256 } from 'js-sha256'
import { PipelineEdDSATicketZuAuthConfig } from '@pcd/passport-interface'
import { ZKEdDSAEventTicketPCDPackage } from '@pcd/zk-eddsa-event-ticket-pcd'
import { zuAuthPopup } from '@pcd/zuauth'

function convertStringArrayToBigIntArray (arr: string[]): bigint[] {
  return arr.map(x => BigInt(x))
}

/**
 * Encoding of -1 in a Baby Jubjub field element (as p-1).
 */
export const BABY_JUB_NEGATIVE_ONE = BigInt(
  '21888242871839275222246405745257275088548364400416034343698204186575808495616'
)

/**
 * Max supported size of validEventIds field in ZKEdDSAEventTicketPCDArgs.
 */
export const VALID_EVENT_IDS_MAX_LEN = 20

export function generateSnarkMessageHash (signal: string): bigint {
  // right shift to fit into a field element, which is 254 bits long
  // shift by 8 ensures we have a 253 bit element
  return BigInt('0x' + sha256(signal)) >> BigInt(8)
}

export const STATIC_TICKET_PCD_NULLIFIER = generateSnarkMessageHash(
  'dummy-nullifier-for-eddsa-event-ticket-pcds'
)

export function snarkInputForValidEventIds (validEventIds?: string[]): string[] {
  if (validEventIds === undefined) {
    validEventIds = []
  }
  if (validEventIds.length > VALID_EVENT_IDS_MAX_LEN) {
    throw new Error(
      'validEventIds for a ZKEdDSAEventTicketPCD can have up to 100 entries.  ' +
        validEventIds.length +
        ' given.'
    )
  }
  const snarkIds = new Array<string>(VALID_EVENT_IDS_MAX_LEN)
  let i = 0
  for (const validId of validEventIds) {
    snarkIds[i] = uuidToBigInt(validId).toString()
    ++i
  }
  for (; i < VALID_EVENT_IDS_MAX_LEN; ++i) {
    snarkIds[i] = BABY_JUB_NEGATIVE_ONE.toString()
  }
  return snarkIds
}

export function publicSignalsFromClaim (
  claim: ZKEdDSAEventTicketPCDClaim
): string[] {
  const t = claim.partialTicket
  const ret: string[] = []

  const negOne = BABY_JUB_NEGATIVE_ONE.toString()

  // Outputs appear in public signals first
  ret.push(
    t.ticketId === undefined ? negOne : uuidToBigInt(t.ticketId).toString()
  )
  ret.push(
    t.eventId === undefined ? negOne : uuidToBigInt(t.eventId).toString()
  )
  ret.push(
    t.productId === undefined ? negOne : uuidToBigInt(t.productId).toString()
  )
  ret.push(
    t.timestampConsumed === undefined ? negOne : t.timestampConsumed.toString()
  )
  ret.push(
    t.timestampSigned === undefined ? negOne : t.timestampSigned.toString()
  )
  ret.push(t.attendeeSemaphoreId || negOne)
  ret.push(
    t.isConsumed === undefined
      ? negOne
      : booleanToBigInt(t.isConsumed).toString()
  )
  ret.push(
    t.isRevoked === undefined ? negOne : booleanToBigInt(t.isRevoked).toString()
  )
  ret.push(
    t.ticketCategory === undefined
      ? negOne
      : numberToBigInt(t.ticketCategory).toString()
  )
  ret.push(
    t.attendeeEmail === undefined
      ? negOne
      : generateSnarkMessageHash(t.attendeeEmail).toString()
  )
  ret.push(
    t.attendeeName === undefined
      ? negOne
      : generateSnarkMessageHash(t.attendeeName).toString()
  )

  // Placeholder for reserved field
  ret.push(negOne)

  ret.push(claim.nullifierHash || negOne)

  // Public inputs appear in public signals in declaration order
  ret.push(hexToBigInt(claim.signer[0]).toString())
  ret.push(hexToBigInt(claim.signer[1]).toString())

  for (const eventId of snarkInputForValidEventIds(claim.validEventIds)) {
    ret.push(eventId)
  }
  ret.push(claim.validEventIds !== undefined ? '1' : '0') // checkValidEventIds

  ret.push(
    claim.externalNullifier?.toString() ||
      STATIC_TICKET_PCD_NULLIFIER.toString()
  )

  ret.push(claim.watermark)

  return ret
}

// uint[2] calldata _pA, uint[2][2] calldata _pB, uint[2] calldata _pC, uint[38] calldata _pubSignals
export const generateWitness = (pcd: ZKEdDSAEventTicketPCD) => {
  const _pA = pcd.proof.pi_a.slice(0, 2)
  const _pB = [
    pcd.proof.pi_b[0].slice(0).reverse(),
    pcd.proof.pi_b[1].slice(0).reverse()
  ]
  const _pC = pcd.proof.pi_c.slice(0, 2)

  const _pubSignals = convertStringArrayToBigIntArray(
    publicSignalsFromClaim(pcd.claim)
  )
  console.log('Witness:', _pA, _pB, _pC, _pubSignals)
  return { _pA, _pB, _pC, _pubSignals }
}

export const isETHBerlinPublicKey = (signer: [string, string]) => {
  return (
    signer[0] ===
      '1ebfb986fbac5113f8e2c72286fe9362f8e7d211dbc68227a468d7b919e75003' &&
    signer[1] ===
      '10ec38f11baacad5535525bbe8e343074a483c051aa1616266f3b1df3fb7d204'
  )
}

export const ETHBERLIN_ZUAUTH_CONFIG: PipelineEdDSATicketZuAuthConfig[] = [
  {
    pcdType: 'eddsa-ticket-pcd',
    publicKey: [
      '1ebfb986fbac5113f8e2c72286fe9362f8e7d211dbc68227a468d7b919e75003',
      '10ec38f11baacad5535525bbe8e343074a483c051aa1616266f3b1df3fb7d204'
    ],
    eventId: '53edb3e7-6733-41e0-a9be-488877c5c572',
    eventName: 'ETHBerlin04',
    productId: '',
    productName: ''
  }
]

export const getProof = async (address: string) => {
  // Get a valid event id from { supportedEvents } from "zuauth" or https://api.zupass.org/issue/known-ticket-types
  const fieldsToReveal = {
    revealAttendeeEmail: true,
    revealEventId: true,
    revealProductId: true
  }
  const result = await zuAuthPopup({
    fieldsToReveal,
    watermark: address,
    config: ETHBERLIN_ZUAUTH_CONFIG
  })
  if (result.type === 'pcd') {
    return JSON.parse(result.pcdStr).pcd
  } else {
    console.error('Failed to parse PCD')
  }
}

export const verifyProofFrontend = async (_pcd: any, address: string) => {
  const deserializedPCD = await ZKEdDSAEventTicketPCDPackage.deserialize(_pcd)

  if (!(await ZKEdDSAEventTicketPCDPackage.verify(deserializedPCD))) {
    console.error(`[ERROR Frontend] ZK ticket PCD is not valid`)
    return
  }

  if (!isETHBerlinPublicKey(deserializedPCD.claim.signer)) {
    console.error(`[ERROR Frontend] PCD is not signed by ETHBerlin`)
    return
  }

  if (
    deserializedPCD.claim.watermark.toString() !==
    hexToBigInt(address as `0x${string}`).toString()
  ) {
    console.error(`[ERROR Frontend] PCD watermark doesn't match`)
    return
  }

  return true
}

export const sendPCDToServer = async (_pcd: any, address: string) => {
  let response
  try {
    response = await fetch('/api/verify', {
      method: 'POST',
      body: JSON.stringify({
        pcd: _pcd,
        address: address
      }),
      headers: {
        'Content-Type': 'application/json'
      }
    })
  } catch (e) {
    console.error(`Error: ${e}`)
    return
  }

  return true
}