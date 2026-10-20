/**
 * Hình đầu trang: bình minh trên vịnh Đà Nẵng, tượng Quan Âm trắng trên sườn Sơn Trà nhìn ra biển.
 * Đây là điểm nhấn duy nhất của giao diện; các phần khác giữ yên tĩnh.
 */
export function HeroArt({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 400 300" preserveAspectRatio="xMidYMax slice" role="img" aria-label="Tượng Quan Âm Chùa Linh Ứng nhìn ra biển lúc bình minh">
      <defs>
        <linearGradient id="h-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0F3B44" />
          <stop offset=".55" stopColor="#4C8A90" />
          <stop offset=".9" stopColor="#E8CF9C" />
        </linearGradient>
        <linearGradient id="h-sea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2A6B73" />
          <stop offset="1" stopColor="#0F3B44" />
        </linearGradient>
        <radialGradient id="h-glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#F6DFAE" stopOpacity=".75" />
          <stop offset="1" stopColor="#F6DFAE" stopOpacity="0" />
        </radialGradient>
      </defs>

      <rect width="400" height="300" fill="url(#h-sky)" />
      <circle cx="306" cy="196" r="70" fill="url(#h-glow)" />
      <circle cx="306" cy="198" r="21" fill="#F6E2B6" />

      {/* dãy núi xa và mặt biển */}
      <path d="M0 168 C70 132 150 172 214 186 C262 196 320 198 400 196 V300 H0Z" fill="#3A747B" />
      <rect y="199" width="400" height="101" fill="url(#h-sea)" />
      <g stroke="#F3D9A4" strokeLinecap="round" opacity=".7">
        <path d="M284 210h44" strokeWidth="2" />
        <path d="M290 221h32" strokeWidth="1.6" />
        <path d="M296 234h20" strokeWidth="1.3" />
        <path d="M300 249h12" strokeWidth="1" />
      </g>

      {/* sườn Sơn Trà gần */}
      <path d="M0 140 C44 128 84 150 120 192 C146 222 190 236 250 244 C290 250 330 262 400 300 H0Z" fill="#163F45" />

      {/* mái chánh điện */}
      <g fill="#0F3036" transform="translate(24 4)">
        <path d="M140 214 h46 v12 h-46z" />
        <path d="M132 214 C146 211 158 204 163 198 C168 204 180 211 194 214 C186 216 140 216 132 214Z" />
      </g>

      {/* tượng Quan Âm */}
      <g transform="translate(30 6)">
      <circle cx="96" cy="112" r="15" fill="none" stroke="#F3D9A4" strokeWidth="1.4" opacity=".75" />
      <g fill="#EEF2F3">
        <path d="M84 196 C90 192 102 192 108 196 L110 202 H82Z" />
        <path d="M89 125 C85 132 84 146 85 160 C86 174 83 186 81 194 H111 C109 186 106 174 107 160 C108 146 107 132 103 125Z" />
        <path d="M89 112 C89 103 103 103 103 112 L106 127 H86Z" />
        <ellipse cx="96" cy="101" rx="3.4" ry="3.6" />
      </g>
      <path d="M93 142 C97 148 101 151 104 151" fill="none" stroke="#B7CBCF" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M90 168 C93 176 92 186 90 194" fill="none" stroke="#C8D7DA" strokeWidth="1" strokeLinecap="round" />
      </g>
    </svg>
  );
}
