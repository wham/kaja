import { GrpcMark, McpMark, OpenApiMark, TwirpMark } from "./protocolMarks";

/**
 * How Kaja works, drawn: an agent on the left, Kaja as a canvas in the middle, the four
 * protocols it speaks on the right.
 *
 * It is what the MCP page shows in place of the agent list while the server is off — a
 * list of configurations to paste only means something once there is a server to point
 * one at, and the space is better spent saying what turning the switch on gets you.
 *
 * The map keeps the website's reading order and drops its colour and its screenshot:
 * strokes only, three weights — `border` for the wires and the canvas's own blocks,
 * `muted-foreground` for the node frames, `foreground` for names and marks. The two
 * wire labels say what travels: MCP in from the agent, CALLS out to the apps. Kaja is
 * drawn as its canvas — text, a table, a call row with a tick — because that is what an
 * agent's run looks like when it lands.
 */

// The apps down the right-hand side, each with the one word its surface is read from.
const PROTOCOLS = [
  { mark: GrpcMark, name: "gRPC", source: ".proto", y: 40 },
  { mark: OpenApiMark, name: "OpenAPI", source: "schema", y: 100 },
  { mark: McpMark, name: "MCP", source: "tools", y: 160 },
  { mark: TwirpMark, name: "Twirp", source: ".proto", y: 220 },
];

export function McpMap({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 880 300"
      role="img"
      aria-label="An agent writes and runs a script over MCP; every call it makes lands on Kaja's canvas, and Kaja speaks gRPC, OpenAPI, MCP and Twirp to your apps."
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <g className="stroke-border" strokeWidth="1.5">
        <path d="M540 150 C 600 150, 620 62, 680 62" />
        <path d="M540 150 C 600 150, 620 122, 680 122" />
        <path d="M540 150 C 600 150, 620 182, 680 182" />
        <path d="M540 150 C 600 150, 620 242, 680 242" />
        <path d="M220 150 H 340" />
      </g>
      <g className="stroke-muted-foreground" strokeWidth="1.5">
        <path d="M334 146l6 4-6 4M674 58l6 4-6 4M674 118l6 4-6 4M674 178l6 4-6 4M674 238l6 4-6 4" />
      </g>
      <text x="270" y="140" textAnchor="middle" fontSize="10.5" letterSpacing="1.2" className="fill-muted-foreground font-mono">
        MCP
      </text>
      <text x="610" y="112" textAnchor="middle" fontSize="10.5" letterSpacing="1.2" className="fill-muted-foreground font-mono">
        CALLS
      </text>

      <rect x="20" y="110" width="200" height="80" rx="8" className="fill-card stroke-muted-foreground" strokeWidth="1.5" />
      {/* Drawn rather than taken from lucide: the antenna is centred, which is what
          keeps this bot from reading as a second icon in a picture full of marks. */}
      <g transform="translate(40 134)" className="stroke-foreground" strokeWidth="2">
        <rect x="3" y="8" width="18" height="13" rx="3" />
        <path d="M12 8V4M9 4h6" />
        <path d="M8.5 14.5v.01M15.5 14.5v.01" />
      </g>
      <text x="74" y="146" fontSize="13" fontWeight="600" className="fill-foreground">
        An agent
      </text>
      <text x="74" y="164" fontSize="11" className="fill-muted-foreground">
        writes the script, runs it
      </text>

      <g className="stroke-muted-foreground" strokeWidth="1.5">
        <rect x="340" y="60" width="200" height="180" rx="8" className="fill-card stroke-muted-foreground" />
        <path d="M340 90h200" />
      </g>
      {/* The Kaja mark at the size this drawing can carry it, in stroke rather than in
          its gradient: the map has three weights and no colour. */}
      <path d="M356 75h5l3-6 4 12 3-6h5" strokeWidth="2" className="stroke-foreground" />
      <text x="384" y="79" fontSize="13" fontWeight="600" className="fill-foreground">
        Kaja
      </text>
      <text x="524" y="79" textAnchor="end" fontSize="10" className="fill-muted-foreground">
        canvas
      </text>
      <g className="stroke-border" strokeWidth="1.5">
        <path d="M358 110h96M358 122h64" />
        <rect x="358" y="138" width="164" height="42" rx="3" />
        <path d="M358 152h164M413 138v42M468 138v42" />
        <rect x="358" y="194" width="164" height="30" rx="3" />
      </g>
      <g className="stroke-muted-foreground" strokeWidth="1.5">
        <path d="M370 209h4l2-4 3 8 2-4h4" />
        <path d="M394 209h78" />
        <path d="M496 205l3 4 6-8" />
      </g>
      <text x="440" y="270" textAnchor="middle" fontSize="11" className="fill-muted-foreground">
        every call lands here, for you to see and approve
      </text>

      {PROTOCOLS.map(({ mark: Mark, name, source, y }) => (
        <g key={name}>
          <rect x="680" y={y} width="160" height="44" rx="8" className="fill-card stroke-muted-foreground" strokeWidth="1.5" />
          <Mark x={694} y={y + 12} size={20} className="text-foreground" />
          <text x="724" y={y + 26} fontSize="13" fontWeight="600" className="fill-foreground">
            {name}
          </text>
          <text x="826" y={y + 26} textAnchor="end" fontSize="11" className="fill-muted-foreground font-mono">
            {source}
          </text>
        </g>
      ))}
    </svg>
  );
}
