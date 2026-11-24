import React from 'react';

/** Shared vector interpretation of the approved CITS LMS brand concept. */
export const CitsBrand: React.FC<{subtitle?:string; inverse?:boolean; compact?:boolean; className?:string}> = ({subtitle,inverse=false,compact=false,className=''})=>(
  <div className={['cits-brand',inverse?'cits-brand-inverse':'',compact?'cits-brand-compact':'',className].filter(Boolean).join(' ')} data-cits-brand>
    <svg viewBox={compact?'0 0 104 48':'0 0 174 48'} className="cits-brand-mark" role="img" aria-label="CITS LMS" xmlns="http://www.w3.org/2000/svg" direction="ltr">
      <path d="M48 16 C69 0 94 -2 101 12 C108 25 95 37 81 42 C94 30 96 21 91 14 C85 6 66 9 48 16Z" fill="var(--cits-swoosh)"/>
      <text x="1" y="36" fontFamily="Arial, Helvetica, sans-serif" fontWeight="900" fontStyle="italic" fontSize="35" letterSpacing="-1.3" fill="var(--cits-word)">CITS</text>
      {!compact&&<><path d="M117 12 H166 Q172 12 170 19 L166 36 Q165 40 159 40 H112 Q106 40 108 33 L112 17 Q113 12 117 12Z" fill="var(--cits-swoosh)"/><text x="139" y="32" fontFamily="Arial, Helvetica, sans-serif" fontSize="21" fontWeight="800" fontStyle="italic" textAnchor="middle" fill="var(--cits-chip-ink)">LMS</text></>}
    </svg>
    {!compact&&subtitle&&<span className="cits-brand-subtitle">{subtitle}</span>}
  </div>
);
