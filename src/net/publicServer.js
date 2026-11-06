/**
 * The public server: the one everybody plays on together unless they choose
 * another. The Online panel offers it first, as one button.
 *
 * Its socket address — wss://your-app.fly.dev/ws, say — once it is running;
 * see HOSTING.md, "The public server". The GitHub Pages build fills it in
 * from the repository variable TERRAGLIDE_PUBLIC_SERVER, so it can be set
 * without touching the code. Empty means there is none yet, and the panel
 * asks for an address instead.
 */
export const PUBLIC_SERVER = '';
