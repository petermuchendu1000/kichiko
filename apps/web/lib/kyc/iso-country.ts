// lib/kyc/iso-country.ts
// ---------------------------------------------------------------------------
// ISO 3166-1 alpha-2 <-> alpha-3, because two systems disagree and a KYC
// record is the wrong place to guess.
//
// Our schema stores CHAR(2) and the app's country pickers are alpha-2. Didit
// speaks alpha-3 in BOTH directions: `expected_details.country` is rejected
// with "Invalid ISO 3166-1 alpha-3 country code" if you send "KE", and
// `id_verifications[].issuing_state` comes back as "KEN".
//
// Truncating is not a conversion. "KEN" to "KE" is right by luck; "ZAF" to
// "ZA" is right by luck too, and "CHE" to "CH" and "DEU" to "DE" are simply
// wrong. A KYC row naming the wrong country of issue is worse than one naming
// none, so this is a real table, generated from the ISO 3166-1 list rather
// than written out by hand.
//
// Stored as one flat string of five characters per country (alpha-2 then
// alpha-3) because 249 object literal entries is a lot of bundle for two
// lookups, and the maps below are built once on first use.

const CODES =
  'ADANDAEAREAFAFGAGATGAIAIAALALBAMARMAOAGOAQATAARARGASASMATAUTAUAUSAWABW' +
  'AXALAAZAZEBABIHBBBRBBDBGDBEBELBFBFABGBGRBHBHRBIBDIBJBENBLBLMBMBMUBNBRN' +
  'BOBOLBQBESBRBRABSBHSBTBTNBVBVTBWBWABYBLRBZBLZCACANCCCCKCDCODCFCAFCGCOG' +
  'CHCHECICIVCKCOKCLCHLCMCMRCNCHNCOCOLCRCRICUCUBCVCPVCWCUWCXCXRCYCYPCZCZE' +
  'DEDEUDJDJIDKDNKDMDMADODOMDZDZAECECUEEESTEGEGYEHESHERERIESESPETETHFIFIN' +
  'FJFJIFKFLKFMFSMFOFROFRFRAGAGABGBGBRGDGRDGEGEOGFGUFGGGGYGHGHAGIGIBGLGRL' +
  'GMGMBGNGINGPGLPGQGNQGRGRCGSSGSGTGTMGUGUMGWGNBGYGUYHKHKGHMHMDHNHNDHRHRV' +
  'HTHTIHUHUNIDIDNIEIRLILISRIMIMNININDIOIOTIQIRQIRIRNISISLITITAJEJEYJMJAM' +
  'JOJORJPJPNKEKENKGKGZKHKHMKIKIRKMCOMKNKNAKPPRKKRKORKWKWTKYCYMKZKAZLALAO' +
  'LBLBNLCLCALILIELKLKALRLBRLSLSOLTLTULULUXLVLVALYLBYMAMARMCMCOMDMDAMEMNE' +
  'MFMAFMGMDGMHMHLMKMKDMLMLIMMMMRMNMNGMOMACMPMNPMQMTQMRMRTMSMSRMTMLTMUMUS' +
  'MVMDVMWMWIMXMEXMYMYSMZMOZNANAMNCNCLNENERNFNFKNGNGANINICNLNLDNONORNPNPL' +
  'NRNRUNUNIUNZNZLOMOMNPAPANPEPERPFPYFPGPNGPHPHLPKPAKPLPOLPMSPMPNPCNPRPRI' +
  'PSPSEPTPRTPWPLWPYPRYQAQATREREUROROURSSRBRURUSRWRWASASAUSBSLBSCSYCSDSDN' +
  'SESWESGSGPSHSHNSISVNSJSJMSKSVKSLSLESMSMRSNSENSOSOMSRSURSSSSDSTSTPSVSLV' +
  'SXSXMSYSYRSZSWZTCTCATDTCDTFATFTGTGOTHTHATJTJKTKTKLTLTLSTMTKMTNTUNTOTON' +
  'TRTURTTTTOTVTUVTWTWNTZTZAUAUKRUGUGAUMUMIUSUSAUYURYUZUZBVAVATVCVCTVEVEN' +
  'VGVGBVIVIRVNVNMVUVUTWFWLFWSWSMYEYEMYTMYTZAZAFZMZMBZWZWE'

const TO_ALPHA3 = new Map<string, string>()
const TO_ALPHA2 = new Map<string, string>()
for (let i = 0; i < CODES.length; i += 5) {
  const a2 = CODES.slice(i, i + 2)
  const a3 = CODES.slice(i + 2, i + 5)
  TO_ALPHA3.set(a2, a3)
  TO_ALPHA2.set(a3, a2)
}

/** "KE" -> "KEN". Null for anything not in ISO 3166-1. */
export function alpha3(code: string | null | undefined): string | null {
  if (!code) return null
  return TO_ALPHA3.get(code.trim().toUpperCase()) ?? null
}

/**
 * "KEN" -> "KE", and "KE" -> "KE" so a caller does not have to know which
 * form the vendor used this time.
 */
export function alpha2(code: string | null | undefined): string | null {
  if (!code) return null
  const c = code.trim().toUpperCase()
  if (c.length === 2) return TO_ALPHA3.has(c) ? c : null
  return TO_ALPHA2.get(c) ?? null
}
