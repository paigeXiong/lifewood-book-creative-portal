export function LoginArtwork({ variant = 0 }: { variant?: number }) {
  if (variant === 1) return <svg className="login-artwork" viewBox="0 0 600 420" fill="none" aria-hidden="true" focusable="false">
    <circle cx="300" cy="210" r="164" stroke="#b5cbb8" strokeOpacity=".15" />
    <path d="M100 328c45-132 351-161 403-26" stroke="#b5cbb8" strokeDasharray="4 9" />
    {[{ x: 86, y: 112, rotate: -12, color: "#a7bcab" }, { x: 352, y: 105, rotate: 12, color: "#d7b87e" }, { x: 220, y: 63, rotate: 0, color: "#e9e6d7" }].map(({ x, y, rotate, color }, index) => <g key={x} transform={`rotate(${rotate} ${x + 74} ${y + 125})`}>
      <rect x={x} y={y} width="148" height="253" rx="12" fill="#315843" stroke="#a6c1ae" strokeWidth="1.5" />
      <rect x={x + 11} y={y + 12} width="126" height="179" rx="6" fill={color} />
      <circle cx={x + 74} cy={y + 71} r="28" fill="#527760" />
      <path d={`M${x + 27} ${y + 174}v-14a47 47 0 0 1 94 0v14Z`} fill="#527760" />
      <path d={`M${x + 29} ${y + 211}h${index === 2 ? 90 : 61}m-${index === 2 ? 90 : 61} 16h43`} stroke="#c4d5c5" strokeWidth="4" strokeLinecap="round" />
    </g>)}
    <path d="m476 67 4 11 11 4-11 4-4 11-4-11-11-4 11-4 4-11Z" fill="#deb66b" />
    <ellipse cx="300" cy="390" rx="194" ry="8" fill="#0f241c" fillOpacity=".25" />
  </svg>;
  if (variant === 2) return <svg className="login-artwork" viewBox="0 0 600 420" fill="none" aria-hidden="true" focusable="false">
    <circle cx="300" cy="205" r="165" stroke="#b5cbb8" strokeOpacity=".15" />
    <rect x="85" y="64" width="431" height="259" rx="13" fill="#284e3d" stroke="#a6c1ae" strokeWidth="1.5" />
    <path d="M100 288 221 128l87 116 65-84 128 128" fill="#6b937b" />
    <path d="m221 128-28 58 26-12 24 17-22-63Z" fill="#e8eee5" />
    <circle cx="432" cy="120" r="23" fill="#deb66b" />
    <path d="M100 288h401M108 307h202" stroke="#dce3d4" strokeWidth="3" strokeLinecap="round" />
    <circle cx="311" cy="307" r="5" fill="#deb66b" />
    <circle cx="299" cy="193" r="30" fill="#f3f0e4" /><path d="m292 179 22 14-22 14v-28Z" fill="#1b3d2f" />
    <path d="M136 351h328" stroke="#a6c1ae" strokeOpacity=".5" />
    {[136, 242, 348].map((x, index) => <g key={x}><rect x={x} y="339" width="88" height="44" rx="6" fill={index === 1 ? "#deb66b" : "#527760"} /><path d={`M${x + 12} 353h47m-47 12h29`} stroke={index === 1 ? "#315843" : "#c4d5c5"} strokeWidth="3" strokeLinecap="round" /></g>)}
    <ellipse cx="300" cy="404" rx="194" ry="7" fill="#0f241c" fillOpacity=".25" />
  </svg>;
  return <svg className="login-artwork" viewBox="0 0 600 420" fill="none" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id="login-page-light" x1="280" y1="140" x2="280" y2="380" gradientUnits="userSpaceOnUse"><stop stopColor="#e8f0eb" stopOpacity=".02" /><stop offset="1" stopColor="#e8f0eb" stopOpacity=".18" /></linearGradient>
    </defs>
    <circle cx="292" cy="205" r="165" stroke="#d9e5dc" strokeOpacity=".15" />
    <circle cx="292" cy="205" r="124" stroke="#d9e5dc" strokeOpacity=".1" strokeDasharray="3 9" />
    <path d="m283 345-132-216 334-42-165 258Z" fill="url(#login-page-light)" />
    <g transform="rotate(-8 350 160)">
      <rect x="210" y="66" width="294" height="184" rx="12" fill="#284e3d" stroke="#a6c1ae" strokeWidth="1.5" />
      <path d="M210 92h294M210 224h294" stroke="#a6c1ae" strokeOpacity=".5" />
      {[228, 266, 304, 342, 380, 418, 456].map(x => <g key={x} fill="#b8cdbd" opacity=".65"><rect x={x} y="75" width="18" height="8" rx="2" /><rect x={x} y="233" width="18" height="8" rx="2" /></g>)}
      <circle cx="438" cy="125" r="19" fill="#deb66b" />
      <path d="m224 217 61-82 47 61 41-50 59 71" fill="#6b937b" />
      <path d="m286 136-14 32 15-6 12 8-13-34Z" fill="#e8eee5" />
      <path d="m337 217 60-62 48 40 45-22v44" fill="#426c54" />
      <path d="M224 217h266" stroke="#b8cdbd" strokeOpacity=".65" />
      <circle cx="359" cy="158" r="27" fill="#f7f5f0" fillOpacity=".95" />
      <path d="m352 146 20 12-20 12v-24Z" fill="#1b3d2f" />
    </g>
    <g stroke="#e4eadd" strokeWidth="1.5" strokeLinejoin="round">
      <path d="m87 304 179-24 37 17 37-17 179 24-31 67-148-8-37 16-37-16-148 8-31-67Z" fill="#315843" />
      <path d="m103 293 156-13 44 17 45-17 155 13-28 61-127-5-45 16-44-16-128 5-28-61Z" fill="#dce3d4" />
      <path d="M303 297c-52-38-110-40-170-32l-17 67c73-4 138 3 187 33 49-30 115-37 187-33l-17-67c-60-8-118-6-170 32Z" fill="#f3f0e4" />
      <path d="M303 297v68" stroke="#91a48b" />
      <g stroke="#a6b29b"><path d="M150 282c49-2 92 6 129 25M146 294c49-2 95 7 133 25M142 306c49-2 97 7 137 25M326 307c39-19 83-27 130-25M326 319c40-18 86-27 135-25M326 331c41-18 90-27 140-25" /></g>
    </g>
    <path d="m132 182 4 11 11 4-11 4-4 11-4-11-11-4 11-4 4-11Z" fill="#deb66b" />
    <path d="m514 268 3 8 8 3-8 3-3 8-3-8-8-3 8-3 3-8Z" fill="#deb66b" />
    <path d="M152 245c-48-48-50-106 3-133" stroke="#b5cbb8" strokeDasharray="4 8" />
    <circle cx="163" cy="108" r="4" fill="#deb66b" />
    <ellipse cx="305" cy="397" rx="185" ry="8" fill="#0f241c" fillOpacity=".25" />
  </svg>;
}
