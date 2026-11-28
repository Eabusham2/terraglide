/**
 * The public server: the one everybody plays on together unless they choose
 * another. The Online panel offers it first, as one button.
 *
 * Its socket address. terraglide.dpdns.org is the project's own server, served
 * through a Cloudflare tunnel; see HOSTING.md, "The public server". The GitHub
 * Pages build replaces this with the repository variable
 * TERRAGLIDE_PUBLIC_SERVER when that is set, so it can be moved without
 * touching the code. Empty would mean there is none, and the panel asks for an
 * address instead.
 */
export const PUBLIC_SERVER = 'wss://terraglide.dpdns.org/ws';
