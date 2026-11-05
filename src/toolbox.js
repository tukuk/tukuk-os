'use strict';
// toolbox.js — the registry behind the second wave of /alat tools (Nov 2026).
//
// Why a registry instead of one page function per tool (the pattern the first
// twenty-nine follow): the goal is a hundred genuinely useful browser-local
// tools, and every tool needs the SAME six things — the route, the hub line,
// the nav item, the sitemap entry, the JSON-LD and the render test. When a page
// function owns those six, the hundredth one is the twenty-ninth place someone
// forgets to update. Here a tool is one object; server.js wires the six from
// TOOLKIT, and test/alat-pages.test.js fails the build if any of them drifts.
//
// The house rules every entry follows, same as the pages added before it:
//   • the whole answer is arithmetic the visitor's browser can verify — no
//     uploads, no API calls, no keys, nothing that costs the server RAM;
//   • English-first copy (the site's global-facing language decision);
//   • the page states the method it uses (Miller–Rabin bases, WCAG maths,
//     Mifflin-St Jeor…) because a tool that hides its maths is an ad farm;
//   • no prayer/life-religion tools by owner direction (Nov 2026).
//
// Script strings are plain ES5 concatenation — no backticks, no ${ — because
// they are embedded inside JS template literals by the builder below.

// ── shared builders ──────────────────────────────────────────────────────────
function field(label, inner) {
  return `<label>${label} ${inner}</label>`;
}

function toolkitPage(t, ctx) {
  const { worldDoc, TOOLS_CSS, toolsNav } = ctx;
  const script = t.script ? `<script>(function(){${t.script}})();</script>` : '';
  // Focus mode (Nov 2026, owner instruction): the tool comes first — form right
  // under the title, and every word of prose (lead, method notes, hub line) folds
  // into one collapsed strip below the result. Still in the DOM for crawlers.
  const body = `<div data-ra="skip">${t.form}</div>
  <noscript><p>JavaScript is required — this tool does its whole work in your browser, which is also why nothing you type ever leaves your device.</p></noscript>
  <details class="tl-more"><summary>ℹ️ What this tool does &amp; how it works</summary><p>${t.lead}</p>${t.seo || ''}
  <p class="meta">Part of <a href="/alat">Everyday Tools</a>. Like everything on tukuk.org: free, no account, no tracking.</p></details>${script}`;
  return worldDoc({
    title: t.title,
    desc: t.desc,
    selfUrl: 'https://tukuk.org/alat/' + t.slug,
    heroTitle: t.ic + ' ' + t.hero,
    heroSub: t.sub,
    css: TOOLS_CSS + (t.css || ''),
    body,
    ld: JSON.stringify({
      '@context': 'https://schema.org', '@type': 'WebApplication', name: 'Tukuk ' + t.name,
      applicationCategory: 'UtilityApplication', operatingSystem: 'Web browser, Android, iOS',
      description: t.desc,
      url: 'https://tukuk.org/alat/' + t.slug,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    }).replace(/</g, '\\u003c'),
  }, toolsNav());
}

function navItems() {
  return TOOLKIT.map((t) => ({ href: '/alat/' + t.slug, icon: t.ic, name: t.name, blurb: t.navBlurb }));
}

function hubLines() {
  return TOOLKIT.map((t) =>
    `  <p><b><a href="/alat/${t.slug}">${t.ic} ${t.name.toLowerCase()}</a></b> — ${t.hubBlurb}</p>`).join('\n');
}

function sitemapPaths() {
  return TOOLKIT.map((t) => '/alat/' + t.slug);
}

const TOOLKIT = [];

// ── 1. /alat/base — number base converter ────────────────────────────────────
TOOLKIT.push({
  slug: 'base', ic: '🔢', name: 'Base Converter',
  title: 'Number Base Converter — Binary, Octal, Hex & Any Base 2–36 | Tukuk-OS',
  desc: 'Convert any whole number between binary, octal, decimal, hexadecimal and any base from 2 to 36, with the division steps shown. Runs entirely in your browser, handles numbers far beyond a calculator.',
  hero: 'Base Converter', sub: 'Binary · octal · decimal · hex · any base 2–36 · exact beyond 64 bits',
  navBlurb: 'Any whole number in base 2, 8, 10, 16 — or any base from 2 to 36 — computed exactly with BigInt, even numbers a desktop calculator overflows.',
  hubBlurb: 'binary ⇄ hex ⇄ decimal and any base 2–36, exact for numbers far past what a calculator holds, with the digit-by-digit maths shown',
  lead: 'One number, every radix at once. Type in any base and read it in all the others — the conversion uses your browser\'s <b>BigInt</b>, so it stays exact far beyond the 2⁵³ limit of ordinary JavaScript numbers (a 64-bit hex value like <code>FEDCBA9876543210</code> converts digit-perfect).',
  form: `<div class="tl-form">
  ${field('Number', '<input id="bc-in" type="text" value="2026" autocomplete="off" spellcheck="false">')}
  ${field('Input base', '<select id="bc-rad"><option value="2">2 · binary</option><option value="8">8 · octal</option><option value="10" selected>10 · decimal</option><option value="16">16 · hex</option><option value="36">36 · max single-symbol base</option><option value="custom">other base (2–36)…</option></select>')}
  ${field('Custom base', '<input id="bc-custom" type="number" min="2" max="36" step="1" value="12">')}
  <button class="tl-btn primary" id="bc-go" type="button">Convert</button>
</div>
<div class="tl-res" id="bc-out">—</div>`,
  script: `
var $=function(id){return document.getElementById(id);};
var NAMES={2:'Binary (base 2)',8:'Octal (base 8)',10:'Decimal (base 10)',16:'Hexadecimal (base 16)',36:'Base 36 (0–9A–Z)'};
function getRad(){var v=$('bc-rad').value;$('bc-custom').style.display=v==='custom'?'':'none';
 if(v!=='custom')return parseInt(v,10);var c=parseInt($('bc-custom').value,10);return (c>=2&&c<=36)?c:NaN;}
function toDec(s,rad){s=s.trim();if(!s)return null;var neg=false;if(s[0]==='-'){neg=true;s=s.slice(1);}
 if(!s)return null;var out=BigInt(0),R=BigInt(rad);
 for(var j=0;j<s.length;j++){var ch=s[j].toUpperCase();var v;
  if(ch>='0'&&ch<='9')v=BigInt(ch.charCodeAt(0)-48);
  else if(ch>='A'&&ch<='Z')v=BigInt(ch.charCodeAt(0)-55);
  else return {err:'"'+s[j]+'" is not a valid base-'+rad+' digit'};
  if(v>=R)return {err:'"'+s[j]+'" does not exist in base '+rad};
  out=out*R+v;}
 return {n:neg?-out:out};}
function fromDec(n,rad){if(n===0n)return '0';var neg=n<0n;if(neg)n=-n;var R=BigInt(rad),s='';
 while(n>0n){s=(n%R).toString(rad).toUpperCase()[0]+s;n/=R;}
 return (neg?'-':'')+s;}
function render(){var raw=$('bc-in').value,rad=getRad();
 if(!(rad>=2&&rad<=36)){$('bc-out').innerHTML='<span class="tl-badge tl-no">check input</span> A custom base must be a whole number from 2 to 36.';return;}
 var r=toDec(raw,rad);
 if(!r||r.err){$('bc-out').innerHTML='<span class="tl-badge tl-no">check input</span> '+(r&&r.err?r.err:'Nothing to convert yet.');return;}
 var html='<div class="tl-big">'+fromDec(r.n,10)+'</div><table class="tl-tab"><tbody>';
 [2,8,10,16,36].concat(rad===2||rad===8||rad===10||rad===16||rad===36?[]:[rad]).forEach(function(b){
  html+='<tr><td>'+(NAMES[b]||('Base '+b+' (digits 0–9A–Z)'))+'</td><td>'+fromDec(r.n,b)+'</td></tr>';});
 html+='</tbody></table><p class="meta">Exact because every step uses BigInt — 9,223,372,036,854,775,807 converts without rounding, unlike double-precision maths.</p>';
 $('bc-out').innerHTML=html;}
$('bc-go').onclick=render;$('bc-in').oninput=render;$('bc-rad').onchange=render;$('bc-custom').oninput=render;render();`,
  seo: `<h2 class="section-title">How radix conversion works</h2>
  <p>Reading a number in base <i>b</i> is Horner's rule: start at zero, and for each digit multiply by <i>b</i> and add the digit's value. Writing it in base <i>b</i> is the mirror image: divide repeatedly by <i>b</i> and collect the remainders from the last one backward. That is exactly what this page computes, in BigInt, so no intermediate value ever rounds. Digits above 9 use A–Z, which is why the practical ceiling for a single-symbol base is 36.</p>`,
});

// ── 2. /alat/binary — text ↔ binary bytes ────────────────────────────────────
TOOLKIT.push({
  slug: 'binary', ic: '🧬', name: 'Text ↔ Binary',
  title: 'Text to Binary Converter — UTF-8 Bytes, Hex & Octal | Tukuk-OS',
  desc: 'Turn text into its UTF-8 bytes in binary, hex, octal or decimal — and back again. See exactly what your keyboard produces, entirely in the browser.',
  hero: 'Text ↔ Binary', sub: 'UTF-8 bytes · binary, hex, octal, decimal · round-trip safe',
  navBlurb: 'Text to UTF-8 bytes as 01101001 and back again, in binary, hex, octal or decimal — the honest way to see what a string really is.',
  hubBlurb: 'type words, get their UTF-8 bytes in 01s (or hex/octal/decimal), and paste bytes back into text exactly',
  lead: 'Computers store text as numbers. This page shows the numbers: every character becomes its <b>UTF-8</b> byte sequence — one byte for plain Latin, two or three for accents, emoji and CJK — rendered as binary, hex, octal or decimal groups, and back again without loss.',
  form: `<div class="tl-form">
  ${field('Direction', '<select id="bt-mode"><option value="t2b" selected>text → codes</option><option value="b2t">codes → text</option></select>')}
  ${field('Code style', '<select id="bt-kind"><option value="bin" selected>binary (01100001)</option><option value="hex">hex (61)</option><option value="oct">octal (141)</option><option value="dec">decimal (97)</option></select>')}
  <button class="tl-btn primary" id="bt-go" type="button">Convert</button>
</div>
<textarea class="tl-in" id="bt-in" spellcheck="false" placeholder="Type text, or paste codes…">Hello, world!</textarea>
<div class="tl-res" id="bt-out">—</div>`,
  script: `
var $=function(id){return document.getElementById(id);};
function bytesToCodes(bytes,kind){var out=[];
 for(var i=0;i<bytes.length;i++){var b=bytes[i];
  if(kind==='bin')out.push(String('0000000'+b.toString(2)).slice(-8));
  else if(kind==='hex')out.push(b.toString(16).toUpperCase());
  else if(kind==='oct')out.push(b.toString(8));
  else out.push(String(b));}
 return out;}
function codesToBytes(tokens,kind){var base=kind==='bin'?2:kind==='hex'?16:kind==='oct'?8:10;var arr=[];
 for(var i=0;i<tokens.length;i++){var v=parseInt(tokens[i],base);
  if(isNaN(v)||v<0||v>255)return {err:'"'+tokens[i]+'" is not a valid '+kind+' byte (0–255)'};
  arr.push(v);}
 return {bytes:new Uint8Array(arr)};}
function render(){var mode=$('bt-mode').value,kind=$('bt-kind').value,raw=$('bt-in').value;
 if(mode==='t2b'){
  var bytes=new TextEncoder().encode(raw);var cs=bytesToCodes(bytes,kind);
  var html='<div class="tl-pick">'+cs.join(kind==='bin'?' ':'')+'</div><p class="meta">'+bytes.length+' UTF-8 byte'+(bytes.length===1?'':'s')+' from '+raw.length+' character'+(raw.length===1?'':'s')+(bytes.length!==raw.length?' — the difference is exactly the multi-byte characters.':'')+'</p>';
  $('bt-out').innerHTML=html;
 }else{
  var tokens=raw.trim().split(/[^0-9a-fA-F]+/).filter(Boolean);
  if(kind==='bin')tokens=raw.replace(/[^01]/g,'').match(/.{1,8}/g)||[];
  var r=codesToBytes(tokens,kind);
  if(r.err){$('bt-out').innerHTML='<span class="tl-badge tl-no">check input</span> '+r.err;return;}
  var text=new TextDecoder('utf-8',{fatal:false}).decode(r.bytes);
  $('bt-out').innerHTML='<div class="tl-pick">'+text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')+'</div><p class="meta">'+tokens.length+' byte'+(tokens.length===1?'':'s')+' decoded.</p>';
 }}
$('bt-go').onclick=render;$('bt-in').oninput=render;$('bt-mode').onchange=render;$('bt-kind').onchange=render;render();`,
  seo: `<h2 class="section-title">Why one character is sometimes more than one byte</h2>
  <p>UTF-8 is variable-width: code points up to U+007F (plain ASCII) take a single byte; accented Latin, Greek, Cyrillic and most symbols take two; CJK and emoji take three or four. The byte counts on this page come from your browser's own <code>TextEncoder</code> — the same encoder that writes every file and network packet — so what you see here is what a computer actually stores.</p>`,
});

// ── 3. /alat/prime — primality & factorisation ───────────────────────────────
TOOLKIT.push({
  slug: 'prime', ic: '🧷', name: 'Prime Checker & Factoriser',
  title: 'Prime Number Checker & Factorisation | Tukuk-OS',
  desc: 'Test whether any number up to 2⁶³ is prime with a deterministic Miller–Rabin test, and split composites into their prime factors, in your browser.',
  hero: 'Prime Checker', sub: 'Deterministic Miller–Rabin · prime factorisation · exact to 2⁶³',
  navBlurb: 'Is it prime? A deterministic Miller–Rabin answer for numbers up to 2⁶³, plus the full prime factorisation when it is not.',
  hubBlurb: 'a proven (not "probably") primality answer for numbers up to 2⁶³ and the prime factorisation underneath any composite',
  lead: 'Two questions in one page: <b>is this number prime?</b> — answered with the deterministic Miller–Rabin test using the twelve bases proven sufficient below 3.3×10²⁴, so the verdict is a proof, not a gamble — and <b>what is it made of?</b>, the prime factorisation by trial division.',
  form: `<div class="tl-form">
  ${field('Number', '<input id="pr-n" type="text" value="2026" autocomplete="off">')}
  <button class="tl-btn primary" id="pr-go" type="button">Analyse</button>
</div>
<div class="tl-res" id="pr-out">—</div>`,
  script: `
var $=function(id){return document.getElementById(id);};
function mulmod(a,b,m){a%=m;b%=m;var r=0n;while(b>0n){if(b&1n)r=(r+a)%m;a=(a*2n)%m;b>>=1n;}return r;}
function powmod(base,exp,m){var out=1n;base%=m;while(exp>0n){if(exp&1n)out=mulmod(out,base,m);base=mulmod(base,base,m);exp>>=1n;}return out;}
function isPrime(n){if(n<2n)return false;var small=[2n,3n,5n,7n,11n,13n,17n,19n,23n,29n,31n,37n];
 for(var i=0;i<small.length;i++)if(n===small[i])return true;
 for(i=0;i<small.length;i++)if(n%small[i]===0n)return false;
 var d=n-1n,s=0n;while((d&1n)===0n){d>>=1n;s++;}
 var bases=[2n,3n,5n,7n,11n,13n,17n,19n,23n,29n,31n,37n];
 outer:for(var b=0;b<bases.length;b++){var a=bases[b]%n;if(a===0n)continue;var x=powmod(a,d,n);
  if(x===1n||x===n-1n)continue;
  for(var r=1n;r<s;r++){x=mulmod(x,x,n);if(x===n-1n)continue outer;}
  return false;}
 return true;}
function factor(n){var fs=[];if(n<2n)return fs;
 var two=0n;while(n%2n===0n){n/=2n;two++;}if(two>0n)fs.push(['2',two]);
 for(var d=3n;d*d<=n&&d<1000000n;d+=2n){if(n%d===0n){var c=0n;while(n%d===0n){n/=d;c++;}fs.push([d.toString(),c]);}}
 if(n>1n)fs.push([n.toString(),isPrime(n)?'prime':(n<1000000000000000n?'prime':'large residue — no factor ≤ 10⁶ found')]);
 return fs;}
function render(){var raw=$('pr-n').value.replace(/[^0-9-]/g,'');var n;
 try{n=BigInt(raw);}catch(e){$('pr-out').innerHTML='<span class="tl-badge tl-no">check input</span> Type a whole number.';return;}
 if(n<2n){$('pr-out').innerHTML='<div class="tl-big">'+raw+'</div><p>Below 2 — not prime by definition (1 has only one divisor; 0 and negatives have infinitely many representations). Primes start at 2.</p>';return;}
 var html;
 if(isPrime(n)){html='<span class="tl-badge tl-ok">PRIME</span><div class="tl-big">'+raw+'</div><p>Divisible by 1 and itself only, proven by deterministic Miller–Rabin (12 bases, exact for every number below 3.3×10²⁴).</p>';}
 else{var fs=factor(n),terms=[];for(var i=0;i<fs.length;i++)terms.push(fs[i][0]+(fs[i][1]>1?'^'+fs[i][1]:''));
  html='<span class="tl-badge tl-no">COMPOSITE</span><div class="tl-big">'+raw+'</div><p>Prime factorisation: <b class="tl-pick">'+terms.join(' × ')+'</b></p>';}
 $('pr-out').innerHTML=html;}
$('pr-go').onclick=render;$('pr-n').oninput=render;render();`,
  seo: `<h2 class="section-title">The maths, stated honestly</h2>
  <p>Trial division alone cannot touch 20-digit numbers; probabilistic tests can be fooled by constructed composites. Miller–Rabin sits between them: for every n below 3,317,044,064,679,887,385,961,981 the twelve bases 2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31 and 37 give a <b>deterministically correct</b> verdict — no probability involved. Factorisation here uses trial division past small primes; a number whose remaining part has no factor ≤ 1,000,000 is reported as such rather than faked into a full split. That refusal is the point: the RSA numbers protecting your bank are hard precisely because nobody has a fast general factoriser.</p>`,
});

// ── 4. /alat/fraction — fraction calculator ──────────────────────────────────
TOOLKIT.push({
  slug: 'fraction', ic: '🍕', name: 'Fraction Calculator',
  title: 'Fraction Calculator — Add, Subtract, Multiply & Divide with Steps | Tukuk-OS',
  desc: 'Add, subtract, multiply and divide fractions with the working shown: cross-multiplied numerator, lowest terms by the Euclidean algorithm, and the mixed-number form. Exact — no floating point.',
  hero: 'Fraction Calculator', sub: '+ − × ÷ · simplified · mixed form · steps printed',
  navBlurb: 'Fractions that show their working: exact + − × ÷ with lowest terms by the Euclidean algorithm and the mixed-number form.',
  hubBlurb: '1/3 + 1/6 answered as 1/2 with every step — common denominator, reduction by GCD, mixed-number and decimal forms',
  lead: 'Calculators turn 1/3 into 0.3333333 and lose the plot. This one keeps fractions <b>as pairs of integers</b> (BigInt), so every answer is exact: the working is printed, the result is reduced by the greatest common divisor, and you also get the mixed number and the decimal.',
  form: `<div class="tl-form">
  ${field('First', '<input id="fr-a" type="text" value="1/3" autocomplete="off">')}
  ${field('Operation', '<select id="fr-op"><option value="+" selected>+</option><option value="-">−</option><option value="*">×</option><option value="/">÷</option></select>')}
  ${field('Second', '<input id="fr-b" type="text" value="1/6" autocomplete="off">')}
  <button class="tl-btn primary" id="fr-go" type="button">Calculate</button>
</div>
<div class="tl-res" id="fr-out">—</div>`,
  script: `
var $=function(id){return document.getElementById(id);};
function gcd(a,b){a=a<0n?-a:a;b=b<0n?-b:b;while(b){var t=a%b;a=b;b=t;}return a;}
function parse(s){s=s.trim();if(!s)return null;var neg=s[0]==='-';if(neg||s[0]==='+')s=s.slice(1);
 var parts=s.split('/');if(parts.length>2)return {err:'More than one slash — that is not a fraction.'};
 var ns=(parts[0].trim())||'0',ds=(parts[1]||'1').trim();var n,d;
 try{n=BigInt(ns);d=BigInt(ds);}catch(e){return {err:'"'+s+'" is not a fraction of whole numbers.'};}
 if(parts.length===2&&d===0n)return {err:'Denominator zero.'};
 if(neg)n=-n;return {n:n,d:d};}
function render(){var A=parse($('fr-a').value),B=parse($('fr-b').value),op=$('fr-op').value;
 if(!A||!B||A.err||B.err){$('fr-out').innerHTML='<span class="tl-badge tl-no">check input</span> '+((A&&A.err)||(B&&B.err)||'Type fractions like 3/4 (a plain number is fine too).');return;}
 var n,d,work;
 if(op==='+'||op==='-'){var l=A.d*B.d/gcd(A.d,B.d);var an=A.n*(l/A.d),bn=B.n*(l/B.d);
  n=op==='+'?an+bn:an-bn;d=l;work='Common denominator '+l+': ('+an+' '+(op==='+'?'+':'−')+' '+bn+') / '+d;}
 else if(op==='*'){n=A.n*B.n;d=A.d*B.d;work='Top × top, bottom × bottom: ('+A.n+'×'+B.n+') / ('+A.d+'×'+B.d+')';}
 else{if(B.n===0n){$('fr-out').innerHTML='<span class="tl-badge tl-no">undefined</span> Division by a fraction equal to zero.';return;}
  n=A.n*B.d;d=A.d*B.n;work='Multiply by the reciprocal: ('+A.n+'×'+B.d+') / ('+A.d+'×'+B.n+')';}
 if(d<0n){n=-n;d=-d;}
 var g=gcd(n,d)||1n;var rn=n/g,rd=d/g;
 var whole=rn/rd,rem=rn%rd;
 var mixed;
 if(rd===1n||rem===0n)mixed=rn+'/'+rd;
 else if(rn>0n)mixed=whole+' '+rem+'/'+rd;
 else mixed='\u2212'+(-whole>0n?(-whole)+' ':'')+(-rem)+'/'+rd;
 var dec=(Number(rn)/Number(rd));
 $('fr-out').innerHTML='<div class="tl-big">'+rn+'/'+rd+'</div><table class="tl-tab"><tbody>'+
 '<tr><td>Result</td><td>'+rn+' / '+rd+'</td></tr>'+
 (g!==1n?'<tr><td>Reduced from</td><td>'+n+' / '+d+' (GCD '+g+')</td></tr>':'')+
 (rd!==1n?'<tr><td>Mixed number</td><td>'+mixed+'</td></tr>':'')+
 '<tr><td>Decimal</td><td>'+dec.toFixed(6).replace(/0+$/,'').replace(/\.$/,'')+'</td></tr>'+
 '<tr><td>Working</td><td>'+work+'</td></tr></tbody></table>';}
$('fr-go').onclick=render;$('fr-a').oninput=render;$('fr-b').oninput=render;$('fr-op').onchange=render;render();`,
  seo: `<h2 class="section-title">Why 0.1 + 0.2 ≠ 0.3 here (but does in calculators)</h2>
  <p>Ordinary computer numbers are binary fractions: 1/3 and 1/10 have no exact form, so a floating-point calculator answers 1/3 + 1/6 with 0.49999999999999994-style dust. This page never converts to floating point for the maths — numerator and denominator stay integers (BigInt), addition uses the lowest common denominator, and reduction divides by the Euclidean GCD. The decimal line is shown only as a convenience at the end.</p>`,
});

// ── 5. /alat/stats — statistics calculator ───────────────────────────────────
TOOLKIT.push({
  slug: 'stats', ic: '📈', name: 'Statistics Calculator',
  title: 'Statistics Calculator — Mean, Median, Mode, Standard Deviation & Quartiles | Tukuk-OS',
  desc: 'Paste numbers and get count, sum, mean, median, mode, range, variance, standard deviation, quartiles and IQR — with the formulas the page used, stated.',
  hero: 'Statistics Calculator', sub: 'mean · median · mode · std dev · quartiles · IQR · instantly',
  navBlurb: 'The full descriptive summary of any list of numbers — mean to quartiles — with the sample-vs-population choice made visible, not hidden.',
  hubBlurb: 'paste a column of numbers, get mean, median, mode, standard deviation, quartiles and IQR — with each formula named beside it',
  lead: 'Descriptive statistics in one pass: every standard summary, and the two choices statistics pages usually hide are made explicit here — <b>sample vs population</b> standard deviation (÷ n−1 vs ÷ n, shown together) and the <b>quartile method</b> (linear interpolation, the type most software calls "inclusive"; different textbooks disagree at the third decimal, so the method is printed with the answer).',
  form: `<textarea class="tl-in" id="st-data" spellcheck="false" placeholder="Paste numbers separated by spaces, commas or newlines…">12, 15, 18, 19, 20, 22, 25, 30, 31, 42</textarea>
<div class="tl-form"><button class="tl-btn primary" id="st-go" type="button">Calculate</button></div>
<div class="tl-res" id="st-out">—</div>`,
  script: `
var $=function(id){return document.getElementById(id);};
function fmt(x){if(!isFinite(x))return '—';var r=Math.round(x*1e6)/1e6;return r.toLocaleString('en-US',{maximumFractionDigits:6});}
function q(sorted,p){if(!sorted.length)return NaN;if(sorted.length===1)return sorted[0];
 var i=(sorted.length-1)*p,lo=Math.floor(i),hi=Math.ceil(i);return sorted[lo]+(sorted[hi]-sorted[lo])*(i-lo);}
function render(){var xs=$('st-data').value.split(/[,;\\s]+/).filter(Boolean).map(Number).filter(isFinite);
 if(xs.length<2){$('st-out').innerHTML='<span class="tl-badge tl-no">need numbers</span> Paste at least two numbers (separated by spaces, commas or lines).';return;}
 var n=xs.length,sum=xs.reduce(function(a,b){return a+b;},0),mean=sum/n;
 var s=xs.slice().sort(function(a,b){return a-b;});
 var median=n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2;
 var fr={},modes=[],mx=0;for(var i=0;i<n;i++){fr[xs[i]]=(fr[xs[i]]||0)+1;if(fr[xs[i]]>mx)mx=fr[xs[i]];}
 for(var k in fr)if(fr[k]===mx&&mx>1)modes.push(k);
 var ssq=xs.reduce(function(a,x){return a+(x-mean)*(x-mean);},0);
 var q1=q(s,.25),q3=q(s,.75);
 var rows=[['Count',n],['Sum',fmt(sum)],['Mean (average)',fmt(mean)],['Median (middle)',fmt(median)],
  ['Mode (most frequent)',modes.length?modes.join(', ')+' (×'+mx+')':'none — every value appears once'],
  ['Minimum',fmt(s[0])],['Maximum',fmt(s[n-1])],['Range',fmt(s[n-1]-s[0])],
  ['Q1 (25th percentile)',fmt(q1)],['Q3 (75th percentile)',fmt(q3)],['Interquartile range',fmt(q3-q1)],
  ['Sum of squared deviations',fmt(ssq)],['Population variance (÷n)',fmt(ssq/n)],
  ['Sample variance (÷n−1)',fmt(ssq/(n-1))],['Population std deviation σ',fmt(Math.sqrt(ssq/n))],
  ['Sample std deviation s',fmt(Math.sqrt(ssq/(n-1)))],
  ['Coefficient of variation',n&&mean!==0?fmt(100*Math.sqrt(ssq/(n-1))/Math.abs(mean))+'% (of the mean)':'—']];
 $('st-out').innerHTML='<table class="tl-tab"><tbody>'+rows.map(function(r){return '<tr><td>'+r[0]+'</td><td>'+r[1]+'</td></tr>';}).join('')+'</tbody></table><p class="meta">Quartiles use linear interpolation between the closest ranks; variance divides by n and by n−1 both, because textbooks disagree about which one your data deserves.</p>';}
$('st-go').onclick=render;$('st-data').oninput=render;render();`,
  seo: `<h2 class="section-title">σ or s — the one choice you have to make</h2>
  <p>If your numbers <i>are</i> the whole population, the standard deviation divides the squared deviations by n. If they are a sample standing in for a bigger population, honest arithmetic divides by n−1 (Bessel's correction), because the sample mean was itself fitted to the data and swallowed one degree of freedom. This page shows both rather than guessing; for large n the two converge and the difference stops mattering.</p>`,
});

// ── 6. /alat/salary — salary ⇄ hourly converter ──────────────────────────────
TOOLKIT.push({
  slug: 'salary', ic: '💼', name: 'Salary Converter',
  title: 'Salary Calculator — Hourly to Annual and Back | Tukuk-OS',
  desc: 'Convert any pay figure between hourly, daily, weekly, monthly and annual, using your real hours and weeks per year — plus the 1.5× overtime rate. Gross maths, in your browser.',
  hero: 'Salary Converter', sub: 'hourly ⇄ weekly ⇄ monthly ⇄ annual · your hours, not assumed · overtime rate',
  navBlurb: 'Hourly to annual and back with your real schedule (hours per week, weeks per year), plus the 1.5× overtime figure — gross maths, no tax claims.',
  hubBlurb: '$25/hour vs $52,000/year, settled in one table — with the overtime rate and an honest "gross, before tax" label',
  lead: 'Salary comparisons go wrong on two hidden assumptions: how many hours a year you actually work, and whether overtime counts. Both are inputs here instead of fine print. All figures are <b>gross pay</b> — no tax, CPF/EPF, or benefits maths is attempted, because those are country-specific and this page would rather be exact about arithmetic than vague about law.',
  form: `<div class="tl-form">
  ${field('Pay amount', '<input id="sa-amt" type="number" step="0.01" min="0" value="25">')}
  ${field('Per', '<select id="sa-per"><option value="hour" selected>hour</option><option value="day">day</option><option value="week">week</option><option value="month">month</option><option value="year">year</option></select>')}
  ${field('Hours / week', '<input id="sa-hrs" type="number" min="1" max="99" step="0.5" value="40">')}
  ${field('Weeks / year', '<input id="sa-wks" type="number" min="1" max="54" step="0.5" value="50">')}
  <button class="tl-btn primary" id="sa-go" type="button">Convert</button>
</div>
<div class="tl-res" id="sa-out">—</div>`,
  script: `
var $=function(id){return document.getElementById(id);};
function money(x){return x.toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2});}
function render(){var amt=parseFloat($('sa-amt').value),per=$('sa-per').value;
 var h=parseFloat($('sa-hrs').value)||40,w=parseFloat($('sa-wks').value)||50;
 if(!isFinite(amt)||amt<0){$('sa-out').innerHTML='<span class="tl-badge tl-no">check amount</span> Enter the pay figure.';return;}
 var hoursYr=h*w;var hourly;
 if(per==='hour')hourly=amt;
 else if(per==='day')hourly=amt/h;
 else if(per==='week')hourly=amt/(h);
 else if(per==='month')hourly=amt/(hoursYr/12);
 else hourly=amt/hoursYr;
 var rows=[['Hourly',money(hourly)],['Daily ('+h+' h)',money(hourly*h)],['Weekly',money(hourly*h)],
  ['Monthly ('+ (w/52*12).toFixed(1) +' wk avg)',money(hourly*h*w/12)],['Annual',money(hourly*hoursYr)],
  ['Overtime hour (1.5×)',money(hourly*1.5)]];
 $('sa-out').innerHTML='<table class="tl-tab"><tbody>'+rows.map(function(r){return '<tr><td>'+r[0]+'</td><td>'+r[1]+'</td></tr>';}).join('')+'</tbody></table><p class="meta">'+w+' weeks × '+h+' hours = <b>'+(hoursYr%1?hoursYr.toFixed(1):hoursYr.toLocaleString('en-US'))+' working hours a year</b> — the number most comparisons assume away. Currency shown as $ for readability; the maths is unitless.</p>';}
$('sa-go').onclick=render;$('sa-amt').oninput=render;$('sa-per').onchange=render;$('sa-hrs').oninput=render;$('sa-wks').oninput=render;render();`,
  seo: `<h2 class="section-title">Why "×12" and "×52" both lie</h2>
  <p>A month is not a twelfth of a pay week cycle and a year is not 52 working weeks once leave is counted. The honest conversion runs through your actual hours per week and weeks per year — everything else (monthly, annual) falls out of that single schedule. Change 50 to 48 to see your holiday reality, or set the hours to your contracted week.</p>`,
});

// ── 7. /alat/tip — tip & bill split ──────────────────────────────────────────
TOOLKIT.push({
  slug: 'tip', ic: '🍽️', name: 'Tip & Bill Split',
  title: 'Tip Calculator & Bill Splitter — With Per-Person Totals | Tukuk-OS',
  desc: 'Work out the tip, the total and each person\'s share at a restaurant table — including rounding up so nobody fumbles with coins. Instant, in your browser.',
  hero: 'Tip & Bill Split', sub: 'tip amount · total · per person · rounded so nobody argues',
  navBlurb: 'The restaurant napkin maths: tip, total and each person\'s share, with a round-up option so the payment is exact down to the coin.',
  hubBlurb: 'bill, tip %, heads — out come the tip, the total and what each person pays, rounded up to avoid the odd-coin stand-off',
  lead: 'Bill, percentage, number of people — the three numbers a table actually needs, plus the polite one: <b>rounded per-person amounts</b> that add back to the total, so the last person is not stuck with 43 cents. If a service charge is already on the bill, enter the discounted amount and tip on what the kitchen actually receives.',
  form: `<div class="tl-form">
  ${field('Bill amount', '<input id="tp-bill" type="number" min="0" step="0.01" value="86.40">')}
  ${field('Tip %', '<input id="tp-pct" type="number" min="0" max="100" step="0.5" value="10">')}
  ${field('People', '<input id="tp-split" type="number" min="1" max="40" step="1" value="4">')}
  <button class="tl-btn primary" id="tp-go" type="button">Split</button>
</div>
<div class="tl-res" id="tp-out">—</div>`,
  script: `
var $=function(id){return document.getElementById(id);};
function money(x){return x.toLocaleString('en-US',{style:'currency',currency:'USD'});}
function render(){var b=parseFloat($('tp-bill').value),p=parseFloat($('tp-pct').value),n=Math.max(1,Math.round(parseFloat($('tp-split').value)||1));
 if(!isFinite(b)||b<0||!isFinite(p)||p<0){$('tp-out').innerHTML='<span class="tl-badge tl-no">check inputs</span> Enter the bill and a tip percentage.';return;}
 var tip=b*p/100,total=b+tip;
 function roundUp(n2){var cents=Math.ceil(total/n2*100)/100;return {each:cents,extra:cents*n2-total};}
 var up=roundUp(n);
 $('tp-out').innerHTML='<div class="tl-big">'+money(up.each)+' <span class="meta" style="font-size:1rem">each</span></div>'+
 '<table class="tl-tab"><tbody>'+
 '<tr><td>Bill</td><td>'+money(b)+'</td></tr>'+
 '<tr><td>Tip ('+p+'%)</td><td>'+money(tip)+'</td></tr>'+
 '<tr><td>Total</td><td>'+money(total)+'</td></tr>'+
 '<tr><td>Exact share ('+n+' '+(n===1?'person':'people')+')</td><td>'+money(total/n)+'</td></tr>'+
 '<tr><td>Rounded up, each pays</td><td>'+money(up.each)+'</td></tr>'+
 (up.extra>0?'<tr><td>Change left over from rounding</td><td>'+money(up.extra)+'</td></tr>':'')+
 '</tbody></table><p class="meta">Suggested: round the tip to a clean figure when the cents are annoying — arithmetic says '+money(tip)+', the table says '+(Math.round(tip)===tip?money(tip):money(Math.round(tip)))+'.</p>';}
$('tp-go').onclick=render;$('tp-bill').oninput=render;$('tp-pct').oninput=render;$('tp-split').oninput=render;render();`,
  seo: `<h2 class="section-title">What counts as a tip at all</h2>
  <p>Tipping customs differ enormously by country (service-included in much of Europe, expected in North America, rare in Japan), so this page takes no position — it computes the number you choose, honestly, including the 0% column that some tables genuinely deserve.</p>`,
});

// ── 8. /alat/discount — percent off calculator ───────────────────────────────
TOOLKIT.push({
  slug: 'discount', ic: '🏷️', name: 'Discount Calculator',
  title: 'Discount Calculator — Percent Off, Stackable Coupons & Final Price | Tukuk-OS',
  desc: 'Percent-off with a second coupon stacked on top: final price, total saved, and the single equivalent discount. Shows why 20%+20% is not 40% off.',
  hero: 'Discount Calculator', sub: 'price · percent off · stacked coupon · the real single %',
  navBlurb: 'Sale price from any percent off, a second coupon applied honestly on the remainder — and the equivalent single discount exposed.',
  hubBlurb: 'what does 30% off then another 20% coupon really cost — the final price, money saved, and the single equivalent percentage',
  lead: 'Two discounts that <b>stack</b> multiply, they do not add: 30% off then 20% off is 44% off, not 50%. This page applies the second coupon to the reduced price (which is how checkout actually works) and prints the equivalent single percentage so the advertising maths stops lying to you.',
  form: `<div class="tl-form">
  ${field('Original price', '<input id="dc-price" type="number" min="0" step="0.01" value="120">')}
  ${field('Discount %', '<input id="dc-off" type="number" min="0" max="100" step="0.5" value="30">')}
  ${field('Extra coupon % (optional)', '<input id="dc-extra" type="number" min="0" max="100" step="0.5" value="20">')}
  <button class="tl-btn primary" id="dc-go" type="button">Calculate</button>
</div>
<div class="tl-res" id="dc-out">—</div>`,
  script: `
var $=function(id){return document.getElementById(id);};
function money(x){return x.toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2});}
function render(){var p=parseFloat($('dc-price').value),d=parseFloat($('dc-off').value),e=parseFloat($('dc-extra').value)||0;
 if(!isFinite(p)||p<0||!isFinite(d)||d<0||d>100){$('dc-out').innerHTML='<span class="tl-badge tl-no">check inputs</span> Price and a discount between 0 and 100.';return;}
 var p1=p*(1-d/100),p2=p1*(1-e/100);
 var eq=p>0?100*(1-p2/p):0;
 $('dc-out').innerHTML='<div class="tl-big">'+money(p2)+'</div><table class="tl-tab"><tbody>'+
 '<tr><td>After '+d+'% off</td><td>'+money(p1)+'</td></tr>'+
 (e>0?'<tr><td>After extra '+e+'% coupon</td><td>'+money(p2)+'</td></tr>':'')+
 '<tr><td>You save</td><td>'+money(p-p2)+'</td></tr>'+
 '<tr><td>Equivalent single discount</td><td>'+eq.toFixed(2).replace(/\.?0+$/,'')+'%</td></tr>'+
 (e>0?'<tr><td>Additive illusion would claim</td><td>'+(d+e)+'% — off '+money(p*(1-(d+e)/100))+' (wrong)</td></tr>':'')+
 '</tbody></table><p class="meta">Compounding: keeping (1−0.30) of a price and then (1−0.20) of that keeps 0.70×0.80 = 0.56 of the original — 44% gone, not 50.</p>';}
$('dc-go').onclick=render;$('dc-price').oninput=render;$('dc-off').oninput=render;$('dc-extra').oninput=render;render();`,
  seo: `<h2 class="section-title">Stacked discounts are multiplication</h2>
  <p>Every percentage-off is a retention factor: 30% off keeps 0.70 of the price. Coupons that apply after the sale multiply the factors — order does not matter, but addition does not work. If a store advertises "50% off everything, plus an extra 20% at checkout", the real factor is 0.50 × 0.80 = 0.40: 60% off. The table above shows that in cents, which is harder to argue with than in percentages.</p>`,
});

// ── 9. /alat/countdown — live countdown to a date ────────────────────────────
TOOLKIT.push({
  slug: 'countdown', ic: '⏳', name: 'Countdown Timer',
  title: 'Countdown to Any Date — Days, Hours, Minutes & Seconds | Tukuk-OS',
  desc: 'A live countdown (or count-up) to any date and time: days, hours, minutes, seconds, plus the total in days and weeks and the weekday it lands on. Runs offline in your browser.',
  hero: 'Countdown', sub: 'live to the second · counts up after the moment passes · no app',
  navBlurb: 'A live seconds-accurate countdown to any date — exams, flights, launches, birthdays — that keeps counting up after it passes.',
  hubBlurb: 'any moment in the future or past, counted to the second and totalled in days and weeks, alive on the page without an app',
  lead: 'Pick a date and time and the counter runs live to the second from your own clock — no accounts, no notification spam. After the moment passes it keeps counting <b>up</b>, which turns the same tool into a birthday, anniversary or "how long has that PR been open" counter.',
  form: `<div class="tl-form">
  ${field('What', '<input id="cd-name" type="text" placeholder="New year" value="New year">')}
  ${field('Date', '<input id="cd-date" type="date">')}
  ${field('Time (local)', '<input id="cd-time" type="time" value="00:00">')}
  <button class="tl-btn primary" id="cd-go" type="button">Start</button>
</div>
<div class="tl-res" id="cd-out">—</div>`,
  script: `
var $=function(id){return document.getElementById(id);};
(function(){var d=new Date(Date.now()+86400000);var p=function(x){return (x<10?'0':'')+x;};$('cd-date').value=d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());})();
var timer=null;
function pad(x){return (x<10?'0':'')+x;}
function tick(target,name){var diff=target-Date.now();var past=diff<0;var t=Math.abs(diff);
 var s=Math.floor(t/1000),m=Math.floor(s/60),h=Math.floor(m/60),days=Math.floor(h/24);
 var big=(past?'':days+'d ')+pad(h%24)+':'+pad(m%60)+':'+pad(s%60);
 $('cd-out').innerHTML='<div class="tl-big">'+big+'</div><table class="tl-tab"><tbody>'+
 '<tr><td>'+(past?'Since':'Until')+'</td><td>'+(name||'that moment')+'</td></tr>'+
 '<tr><td>Landing day</td><td>'+target.toLocaleString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'})+' at '+target.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'})+'</td></tr>'+
 '<tr><td>Total days</td><td>'+(t/86400000).toFixed(2).replace(/\.?0+$/,'')+'</td></tr>'+
 '<tr><td>In weeks</td><td>'+(t/604800000).toFixed(2).replace(/\.?0+$/,'')+'</td></tr>'+
 '<tr><td>Total '+(past?'elapsed':'remaining')+'</td><td>'+days+' d · '+h%24+' h · '+m%60+' min · '+s%60+' s</td></tr>'+
 '</tbody></table><p class="meta">Counted from your own clock — close the tab and it restarts from the same target; this page stores nothing anywhere.</p>';}
function start(){if(timer)clearInterval(timer);
 var d=$('cd-date').value,t=$('cd-time').value||'00:00';
 if(!d){$('cd-out').innerHTML='<span class="tl-badge tl-no">pick a date</span> Choose the day to count to.';return;}
 var target=new Date(d+'T'+(t.length===5?t+':00':t));
 if(isNaN(target.getTime())){$('cd-out').innerHTML='<span class="tl-badge tl-no">bad date</span> Your browser did not accept that date/time.';return;}
 var name=$('cd-name').value;
 timer=setInterval(function(){tick(target,name);},1000);tick(target,name);}
$('cd-go').onclick=start;$('cd-date').onchange=start;$('cd-time').onchange=start;start();`,
  seo: `<h2 class="section-title">Why the countdown is honest about clocks</h2>
  <p>Everything is computed between your device's clock and your chosen local time — the same subtraction your phone's alarm does. If the device clock drifts (they do, until the next network sync), so does the counter; for second-exact events like a rocket burn, trust the mission clock, not a browser tab.</p>`,
});

// ── 10. /alat/grade — what you need on the final ─────────────────────────────
TOOLKIT.push({
  slug: 'grade', ic: '🎓', name: 'Grade Calculator',
  title: 'Grade Calculator — What Do I Need on the Final Exam? | Tukuk-OS',
  desc: 'The one weighted-grade question that matters: what you must score on the final to hit your target — and what your target becomes for every possible score, honestly.',
  hero: 'Grade Calculator', sub: 'current % · target % · final weight · the number you need',
  navBlurb: 'What you need on the final for the grade you want — or a straight "it is mathematically impossible" with the best achievable score.',
  hubBlurb: 'current grade, final weight, target — out comes the score you need, or the honest impossibility plus the best case',
  lead: 'final = (goal − current × (1 − w)) ÷ w — that single line is the whole tool. The page then does the two things a bare formula cannot: <b>refuses politely</b> when the target is unreachable even at 100%, and prints what your final grade <i>will</i> be for every possible exam score, so the risk is visible instead of averaged away.',
  form: `<div class="tl-form">
  ${field('Current grade %', '<input id="gr-cur" type="number" min="0" max="100" step="0.1" value="78">')}
  ${field('Target grade %', '<input id="gr-goal" type="number" min="0" max="100" step="0.1" value="85">')}
  ${field('Final exam weight %', '<input id="gr-wt" type="number" min="1" max="100" step="1" value="30">')}
  <button class="tl-btn primary" id="gr-go" type="button">Calculate</button>
</div>
<div class="tl-res" id="gr-out">—</div>`,
  script: `
var $=function(id){return document.getElementById(id);};
function r2(x){return (Math.round(x*100)/100).toFixed(2).replace(/\.?00$/,'');}
function render(){var cur=parseFloat($('gr-cur').value),goal=parseFloat($('gr-goal').value),w=parseFloat($('gr-wt').value)/100;
 if(!isFinite(cur)||!isFinite(goal)||!isFinite(w)||w<=0||w>1){$('gr-out').innerHTML='<span class="tl-badge tl-no">check inputs</span> Current %, target %, and a weight between 1 and 100.';return;}
 var need=(goal-cur*(1-w))/w,best=cur*(1-w)+100*w,worst=cur*(1-w);
 var html;
 if(need>100)html='<span class="tl-badge tl-no">not reachable</span><p>Even a perfect 100% final gives <b>'+r2(best)+'%</b> — short of the '+goal+'% target by '+r2(goal-best)+' points. The maths does not bluff; ask about the weightings instead.</p>';
 else if(need<0)html='<span class="tl-badge tl-ok">already safe</span><p>You hold the '+goal+'% even scoring <b>zero</b> on the final — your floor is <b>'+r2(worst)+'%</b> anyway. The target is a formality.</p>';
 else html='<div class="tl-big">score '+r2(Math.max(0,need))+'% or more</div><p>That lands exactly on '+goal+'%. Anything above it is margin; below it, the table below is your landing zone.</p>';
 var rows='';[0,20,40,60,80,100].forEach(function(x){
  var fin=cur*(1-w)+x*w;rows+='<tr><td>'+x+'%</td><td>'+r2(fin)+'%</td></tr>';});
 html+='<table class="tl-tab"><thead><tr><th>Exam score</th><th>Final grade</th></tr></thead><tbody>'+rows+'</tbody></table>'+
 '<p class="meta">Formula: final = '+cur+' × '+(1-w).toFixed(2).replace(/0$/,'')+' + exam × '+w.toFixed(2).replace(/0$/,'')+'. "Current grade" must be the weighted mark of everything already graded — if your syllabus has different weights per component, fold them into that number first.</p>';
 $('gr-out').innerHTML=html;}
$('gr-go').onclick=render;$('gr-cur').oninput=render;$('gr-goal').oninput=render;$('gr-wt').oninput=render;render();`,
  seo: `<h2 class="section-title">The two mistakes this prevents</h2>
  <p>First: plugging a negative "need" as panic instead of relief — a below-zero answer means you are already safe, and this page says so with a green badge. Second: trusting a site that rounds an unreachable target up to "aim for 112%" — an impossible target is a scheduling decision, not a study decision, and the honest answer is the one printed here.</p>`,
});

// ── 11. /alat/entity — HTML entity encoder/decoder ───────────────────────────
TOOLKIT.push({
  slug: 'entity', ic: '🔣', name: 'HTML Entities',
  title: 'HTML Entity Encoder & Decoder — Escape <, >, & and Unicode | Tukuk-OS',
  desc: 'Escape text for HTML (named entities, numeric references, or every non-ASCII character) and decode entity soup back to text. The exact codec your browser itself uses.',
  hero: 'HTML Entities', sub: 'escape &lt; &gt; &amp; · named & numeric · decode back',
  navBlurb: 'Encode text so it survives an HTML parser and decode entity soup back, using the browser\'s own decoding table — nothing sent anywhere.',
  hubBlurb: 'make &lt;script&gt; safe to display, turn "©" into &#169; or back, using the browser\'s own codec',
  lead: `Two directions, one guarantee: whatever the browser's <b>parser</b> accepts, this page produces, and whatever standard entities exist, it decodes using the browser's own table. Encoding escapes the five characters that break HTML (<code>&amp; &lt; &gt; "</code> and <code>&#39;</code>); the optional mode additionally turns every non-ASCII character into a numeric reference, which is how mail archives and legacy pages survive being copied through tools that mangle UTF-8.`,
  form: `<div class="tl-form">
  <label style="flex:1;min-width:260px">Text <textarea class="tl-in" id="en-in" spellcheck="false">5 < 7 && "quotes" — © 2026 — café ☕</textarea></label>
</div>
<div class="tl-form">
  <label><input id="en-all" type="checkbox" style="min-width:auto"> encode non-ASCII as numeric refs too</label>
  <button class="tl-btn primary" id="en-enc" type="button">Encode</button>
  <button class="tl-btn" id="en-dec" type="button">Decode</button>
  <button class="tl-btn" id="en-copy" type="button">Copy result</button>
</div>
<div class="tl-res" id="en-out">—</div>`,
  script: `
var $=function(id){return document.getElementById(id);};
var last='';
function enc(s,all){var out='',i;
 for(i=0;i<s.length;i++){var c=s[i];
  if(c==='&')out+='&amp;';else if(c==='<')out+='&lt;';else if(c==='>')out+='&gt;';
  else if(c==='"')out+='&quot;';else if(c==="'")out+='&#39;';
  else if(all&&(c.charCodeAt(0)>126||c.charCodeAt(0)<32&&c!=='\\n'&&c!=='\\t')){
   var cp=s.codePointAt(i);out+='&#'+cp+';';if(cp>65535)i++;}
  else out+=c;}
 return out;}
function dec(s){var ta=document.createElement('textarea');ta.innerHTML=s;return ta.value;}
function show(t){last=t;$('en-out').textContent=t;}
$('en-enc').onclick=function(){show(enc($('en-in').value,$('en-all').checked));};
$('en-dec').onclick=function(){show(dec($('en-in').value));};
$('en-copy').onclick=function(){if(!last)return;
 if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(last).then(function(){show('Copied — the same result is in your clipboard.');});
 else{var ta=document.createElement('textarea');ta.value=last;document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);show('Copied.');}};
$('en-enc').click();`,
  seo: `<h2 class="section-title">When escaping is the whole security story</h2>
  <p>Injection bugs in web applications are overwhelmingly one forgotten escape: user text containing <code>&lt;script&gt;</code> that the page pastes straight into HTML. Context decides the rule — element text needs &amp;/&lt;/&gt; only, attribute values also need quote escaping (both named and numeric forms work anywhere), and JavaScript inside HTML needs neither of these and its own rules instead. Copying from this page is safe; the encoder emits no whitespace changes and re-encoding already-encoded text only touches the ampersands.</p>`,
});

// ── 12. /alat/jwt — JWT decoder ──────────────────────────────────────────────
TOOLKIT.push({
  slug: 'jwt', ic: '🎫', name: 'JWT Decoder',
  title: 'JWT Decoder — Read Your Token\'s Header & Claims | Tukuk-OS',
  desc: 'Paste a JSON Web Token and read it: header algorithm, every claim with exp/iat/nbf turned into real dates, expiry verdict. The signature is explicitly NOT verified — and the page says why.',
  hero: 'JWT Decoder', sub: 'header · claims table · exp/iat made human · no signature lie',
  navBlurb: 'Read any JWT\'s header and claims with expiry dates made human — and an honest refusal to pretend an unsigned token is verified.',
  hubBlurb: 'what is inside my token — every claim decoded, exp/iat shown as real dates, with the signature-never-verified warning in the copy, not the fine print',
  lead: 'A JWT is not encrypted — it is three base64url segments holding plain JSON, which is why this page can read yours and why <b>nothing secret belongs in one</b>. Paste a token and get the header (algorithm), every claim, and expiry/issued dates converted to your calendar. The signature <i>cannot</i> be checked here because you do not have the issuer\'s key — anyone who tells you a JWT is "verified" from the token alone is selling something.',
  form: `<textarea class="tl-in" id="jw-tok" spellcheck="false" placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." style="min-height:110px"></textarea>
<div class="tl-form"><button class="tl-btn primary" id="jw-go" type="button">Decode</button></div>
<pre class="tl-res" id="jw-head" style="white-space:pre-wrap"></pre>
<div class="tl-res" id="jw-claims">Paste a token to see its header and claims. Nothing is sent to a server — decoding happens in this page.</div>`,
  script: `
var $=function(id){return document.getElementById(id);};
function b64url(s){s=s.replace(/-/g,'+').replace(/_/g,'/');while(s.length%4)s+='=';
 var bin=atob(s);var by=new Uint8Array(bin.length);for(var i=0;i<bin.length;i++)by[i]=bin.charCodeAt(i);
 return new TextDecoder('utf-8').decode(by);}
function esc(t){return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
var KNOWN={alg:'algorithm',typ:'type',kid:'key id',cty:'content type',
 iss:'issuer',sub:'subject',aud:'audience',exp:'expires at',nbf:'not valid before',iat:'issued at',jti:'token id'};
function render(){var t=$('jw-tok').value.trim();
 if(!t){$('jw-head').textContent='';$('jw-claims').innerHTML='Paste a token to see its header and claims. Nothing is sent to a server — decoding happens in this page.';return;}
 var ps=t.split('.');
 if(ps.length<2||ps.length>3){$('jw-claims').innerHTML='<span class="tl-badge tl-no">not a JWT</span> A JWT is two or three dot-separated segments; this has '+ps.length+'.';$('jw-head').textContent='';return;}
 var head,pay;
 try{head=JSON.parse(b64url(ps[0]));pay=JSON.parse(b64url(ps[1]));}
 catch(e){$('jw-claims').innerHTML='<span class="tl-badge tl-no">cannot parse</span> The segments are not valid base64url JSON — double-check the paste.';$('jw-head').textContent='';return;}
 $('jw-head').textContent='header  '+JSON.stringify(head,null,2);
 var now=Math.floor(Date.now()/1000),rows='';
 Object.keys(pay).forEach(function(k){var v=pay[k],cell;
  if((k==='exp'||k==='iat'||k==='nbf')&&typeof v==='number'){
   var d=new Date(v*1000);cell=d.toLocaleString('en-US')+' <span class="meta">('+v+')</span>';
  }else{
   cell=esc(typeof v==='object'?JSON.stringify(v):String(v));
  }
  rows+='<tr><td>'+esc(k)+(KNOWN[k]?' <span class="meta">· '+KNOWN[k]+'</span>':'')+'</td><td style="text-align:left">'+cell+'</td></tr>';});
 var verdict='';
 if(typeof pay.exp==='number')verdict+=pay.exp<now?'<span class="tl-badge tl-no">EXPIRED</span> expired '+new Date(pay.exp*1000).toLocaleString('en-US')+'. ':'<span class="tl-badge tl-ok">unexpired</span> valid until '+new Date(pay.exp*1000).toLocaleString('en-US')+'. ';
 if(typeof pay.nbf==='number'&&pay.nbf>now)verdict+='<span class="tl-badge tl-no">not yet valid</span> starts '+new Date(pay.nbf*1000).toLocaleString('en-US')+'. ';
 if(ps.length===3)verdict+='<span class="meta">Signature segment present — not verifiable here (needs the issuer\\'s key).</span>';
 else verdict+='<span class="meta">Unsecured (alg none / detached) — treat as plain text, nothing more.</span>';
 $('jw-claims').innerHTML=(verdict?'<p>'+verdict+'</p>':'')+'<table class="tl-tab"><thead><tr><th>Claim</th><th style="text-align:right">Value</th></tr></thead><tbody>'+rows+'</tbody></table>';}
$('jw-go').onclick=render;$('jw-tok').oninput=render;`,
  seo: `<h2 class="section-title">What a token is, and what it is not</h2>
  <p>header.payload.signature — each segment base64url, the signature made with a key only the issuer holds. Anyone can read; only the issuer can make read-proof. That is why the honest design of a JWT decoder is <i>this page</i>: entirely local, explicitly non-verifying, and loud about expiry, because "the token decoded fine" has ended more security investigations than any bug. For debugging signature failures you need the library that verifies with the real key, not a website.</p>`,
});

// ── 13. /alat/roman — Roman numerals ───────────────────────────────────────────────
TOOLKIT.push({
  slug: 'roman', ic: '🏛️', name: 'Roman Numerals',
  title: 'Roman Numeral Converter — 1 to 3999 Both Ways, With the Rules Shown | Tukuk-OS',
  desc: 'Turn any number from 1 to 3999 into a Roman numeral and back, with the subtractive rules (IV, IX, XL, XC, CD, CM) explained and non-standard forms like IIII flagged. Runs in your browser.',
  hero: 'Roman Numerals', sub: '1–3999 both ways · subtractive pairs enforced · IIII flagged, not swallowed',
  navBlurb: 'Numbers to Roman and back with the real canonical rules — the page tells you IIII is a clock, not a document.',
  hubBlurb: 'MMXXVI for any year or chapter number, both directions, with the six subtractive pairs enforced instead of guessed',
  lead: 'Romans wrote numbers as letters: I=1, V=5, X=10, L=50, C=100, D=500, M=1000, and six exceptions where a smaller letter before a bigger one <i>subtracts</i> — IV(4), IX(9), XL(40), XC(90), CD(400), CM(900). This page converts both ways and checks the numeral is spelled <b>canonically</b>: IIII reads as 4, but the tool says so instead of pretending it is how Romans wrote it.',
  form: `<div class="tl-form">
  ${field('Direction', '<select id="rm-mode"><option value="i2r" selected>number → Roman</option><option value="r2i">Roman → number</option></select>')}
  ${field('Value', '<input id="rm-in" type="text" value="2026" autocomplete="off" spellcheck="false">')}
  <button class="tl-btn primary" id="rm-go" type="button">Convert</button>
</div>
<div class="tl-res" id="rm-out">—</div>`,
  script: `
var $=function(id){return document.getElementById(id);};
var V=[[1000,'M'],[900,'CM'],[500,'D'],[400,'CD'],[100,'C'],[90,'XC'],[50,'L'],[40,'XL'],[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']];
function toRoman(n){var s='';for(var i=0;i<V.length;i++){while(n>=V[i][0]){s+=V[i][1];n-=V[i][0];}}return s;}
var VALS={I:1,V:5,X:10,L:50,C:100,D:500,M:1000};
function fromRoman(s){var tot=0;
 for(var i=0;i<s.length;i++){var v=VALS[s[i]];if(!v)return {err:'"'+s[i]+'" is not a Roman letter (only I V X L C D M exist)'};
  var nv=VALS[s[i+1]]||0;if(v<nv){tot+=nv-v;i++;}else tot+=v;}
 return {n:tot};}
function render(){var mode=$('rm-mode').value,raw=$('rm-in').value.trim();
 if(mode==='i2r'){var n=parseInt(raw,10);
  if(!(n>=1&&n<=3999)){$('rm-out').innerHTML='<span class="tl-badge tl-no">out of range</span> With single symbols the system runs 1–3999; larger numbers needed an overline the ancients did not standardise. No fake M\u0304 here.';return;}
  $('rm-out').innerHTML='<div class="tl-big">'+toRoman(n)+'</div><p class="meta">'+n+' = <b>'+toRoman(n)+'</b>, built greedily: subtract the largest value that fits (1000, 900, 500, 400\u2026) and append its letter. Where the greedy run would repeat a symbol four times, a subtractive pair steps in instead \u2014 4 is IV, not IIII.</p>';return;}
 var s=raw.toUpperCase();
 if(!s){$('rm-out').innerHTML='Type a numeral like MMXXVI.';return;}
 var r=fromRoman(s);
 if(r.err){$('rm-out').innerHTML='<span class="tl-badge tl-no">check input</span> '+r.err;return;}
 if(!(r.n>=1&&r.n<=3999)||toRoman(r.n)!==s){$('rm-out').innerHTML='<span class="tl-badge tl-no">not canonical</span> '+s+' reads as '+r.n+', but the standard spelling of '+r.n+' is <b>'+toRoman(r.n)+'</b>. Clockfaces and movie credits love IIII and other old forms; modern documents do not.';return;}
 $('rm-out').innerHTML='<div class="tl-big">'+r.n+'</div><p class="meta">'+s+' = '+r.n+'. Verified canonical: re-encoding '+r.n+' reproduces '+s+' letter for letter.</p>';}
$('rm-go').onclick=render;$('rm-in').oninput=render;$('rm-mode').onchange=render;render();`,
  seo: `<h2 class="section-title">Why there is no Roman zero</h2>
  <p>Roman numerals count things, and a counting Roman had no symbol for nothing — the word <i>nulla</i> (nothing) served medieval mathematicians, and the letterless gaps in their abacus did the arithmetic. That absence is why the system has no place values and never needed one: each letter simply carries its own worth, added left to right, with the subtractive pairs as an agreed shorthand. This page refuses inputs above 3999 for the same honesty reason — the overline-for-times-a-thousand convention was never one convention, and picking one silently would be inventing history.</p>`,
});

// ── 14. /alat/number-to-words — words & cheque phrasing ──────────────────────
TOOLKIT.push({
  slug: 'number-to-words', ic: '🔤', name: 'Number to Words',
  title: 'Number to Words Converter — English Words & Cheque Phrasing | Tukuk-OS',
  desc: 'Write any number up to a septillion in English words, or in cheque form (dollars and cents spelled out). Short scale stated, no floating-point surprises. All in your browser.',
  hero: 'Number to Words', sub: 'words or cheque form · short scale stated · exact to 24 digits',
  navBlurb: 'Any number spelled out — including the cheque form banks actually ask for — exact up to 24 digits because it runs on integers, not floats.',
  hubBlurb: 'fill the cheque line right: 1,234,567.89 becomes "one million two hundred thirty-four thousand… five hundred sixty-seven dollars and 89 cents", exactly',
  lead: 'The number words that go on a cheque, a contract, or a headline. Input is handled as a <b>string of digits</b> and split in groups of three, so it stays exact far past the point where JavaScript numbers start rounding (2⁵³ ≈ 9.007×10¹⁵). The wording follows the US/international <b>short scale</b> — one million, one billion = 10⁹ — and says so, because long-scale Europe means 10¹² when it says billion.',
  form: `<div class="tl-form">
  ${field('Number', '<input id="nw-in" type="text" value="1234567.89" autocomplete="off">')}
  ${field('Style', '<select id="nw-mode"><option value="words" selected>plain words</option><option value="cheque">cheque: dollars and cents</option><option value="british">UK: and after hundreds</option></select>')}
  <button class="tl-btn primary" id="nw-go" type="button">Spell</button>
</div>
<div class="tl-res" id="nw-out">—</div>`,
  script: `
var $=function(id){return document.getElementById(id);};
var ONES=['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen'];
var TENS=['','','twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety'];
var SCALES=['','thousand','million','billion','trillion','quadrillion','quintillion','sextillion','septillion'];
function u100(n){return n<20?ONES[n]:TENS[Math.floor(n/10)]+(n%10?'-'+ONES[n%10]:'');}
function u1000(n,uk){var h=Math.floor(n/100),r=n%100,out='';
 if(h)out+=ONES[h]+' hundred'+(r?(uk?' and ':' '):'');
 if(r)out+=u100(r);
 return out;}
function groupWords(digits,uk){var groups=[],s=digits;
 while(s.length>3){groups.unshift(s.slice(-3));s=s.slice(0,-3);}groups.unshift(s);
 var parts=[];
 for(var i=0;i<groups.length;i++){var g=parseInt(groups[i],10);if(!g)continue;
  var scale=groups.length-1-i;
  if(scale>=SCALES.length)return {err:'above septillion'};
  parts.push(u1000(g,uk)+(scale?' '+SCALES[scale]:''));}
 if(!parts.length&&groups.length&&(s==='000'||digits==='0'||digits===''))return {w:'zero'};
 return {w:parts.length?parts.join(' '):(digits==='0'?'zero':'')};}
function render(){var raw=$('nw-in').value.replace(/[,\\s]/g,''),mode=$('nw-mode').value;
 if(!/^-?\\d{1,24}(\\.\\d{1,2})?$/.test(raw)){$('nw-out').innerHTML='<span class="tl-badge tl-no">check input</span> Up to 24 whole digits, optional two decimal places (that is the cheque rule).';return;}
 var neg=raw[0]==='-',rest=neg?raw.slice(1):raw,dot=rest.indexOf('.'),whole=dot<0?rest:rest.slice(0,dot),fr=dot<0?'':rest.slice(dot+1);
 whole=whole.replace(/^0+(?=\\d)/,'');
 if(/^0+$/.test(whole)&&/^0*$/.test(fr))neg=false;
 var uk=mode==='british';
 var g=groupWords(whole,uk);
 if(g.err){$('nw-out').innerHTML='<span class="tl-badge tl-no">too big</span> Short-scale names stop at septillion (10²⁴). Scientific words exist; cheque names do not.';return;}
 var out=(neg?'minus ':'')+g.w;
 if(mode==='cheque'){
  var cents=fr?(fr+'0').slice(0,2):'00';
  out=out+' dollars and '+cents+' cents'+(cents==='00'?' — write 00/100 exactly':'');
  out+='<span class="meta"> · bank style: append /100 and the line reads like an instrument, not a blog post.</span>';
 }else if(fr){out+=' point';for(var i=0;i<fr.length;i++)out+=' '+ONES[+fr[i]];}
 $('nw-out').innerHTML='<div class="tl-pick" style="font-size:1.1rem">'+out+'</div><p class="meta">Short scale: a billion here is 10⁹. In long-scale languages the same words mean 10¹² — translate numbers carefully.</p>';}
$('nw-go').onclick=render;$('nw-in').oninput=render;$('nw-mode').onchange=render;render();`,
  seo: `<h2 class="section-title">Why 9007199254740993 is where normal calculators die</h2>
  <p>JavaScript stores numbers as IEEE-754 doubles: above 2⁵³ the spacing between representable values exceeds 1, and 9007199254740993 silently becomes \u202692. Pages that take your figure "as a number" therefore spell the last digits <i>wrong</i> on large sums. This one keeps your input as a digit string and converts group by group, so a twenty-four-digit number gets exactly the words it asked for. The hyphen rule follows standard English style (twenty-six, one hundred and one); the Oxford "and" after hundreds is the British variant, selectable above.</p>`,
});

// ── 15. /alat/duration — seconds to human time ───────────────────────────────
TOOLKIT.push({
  slug: 'duration', ic: '⏲️', name: 'Duration Converter',
  title: 'Duration Converter — Seconds to Days, Hours, Minutes | Tukuk-OS',
  desc: 'Convert any span of time between seconds, minutes, hours, days and weeks the way humans say it (2d 8h 16m 40s), the other direction included. Browser-local.',
  hero: 'Duration Converter', sub: 'seconds ⇄ human · d·h·m·s breakdown · no fake months',
  navBlurb: 'A raw span of seconds read the way people say it — 2d 8h 16m 40s — and back, refusing to pretend a month has a fixed length.',
  hubBlurb: 'turn 202600 seconds into "2 days, 8 hours, 16 minutes, 40 seconds" — and back — with the month/ambiguity traps named',
  lead: 'Machines count seconds; humans say "two and a half days". This page converts a single span between s, min, h, d and wk, prints the natural breakdown, and deliberately <b>stops at weeks</b>: a month is 28–31 days and a year 365 or 366, so any "months" answer would be a guess about your calendar.',
  form: `<div class="tl-form">
  ${field('Amount', '<input id="du-in" type="number" step="any" value="202600">')}
  ${field('Unit', '<select id="du-unit"><option value="s" selected>seconds</option><option value="min">minutes</option><option value="h">hours</option><option value="d">days</option><option value="wk">weeks</option></select>')}
  <button class="tl-btn primary" id="du-go" type="button">Convert</button>
</div>
<div class="tl-res" id="du-out">—</div>`,
  script: `
var $=function(id){return document.getElementById(id);};
var PER={s:1,min:60,h:3600,d:86400,wk:604800};
function human(t){var d=Math.floor(t/86400),h=Math.floor(t%86400/3600),m=Math.floor(t%3600/60),s=Math.floor(t%60);
 var parts=[];if(d)parts.push(d+'d');if(h)parts.push(h+'h');if(m)parts.push(m+'m');if(s)parts.push(s+'s');
 if(!parts.length)parts.push(Math.round(t*10)/10+'s');return parts.join(' ');}
function render(){var v=parseFloat($('du-in').value),u=$('du-unit').value;
 if(!isFinite(v)||v<0){$('du-out').innerHTML='<span class="tl-badge tl-no">check input</span> A duration is a non-negative number of '+u+'.';return;}
 var t=v*PER[u];
 var rows=[['Seconds',t.toLocaleString('en-US',{maximumFractionDigits:3})],
  ['Minutes',t/60],['Hours',t/3600],['Days',t/86400],['Weeks',t/604800]];
 var tbl='<table class="tl-tab"><tbody>'+rows.map(function(r){
  return '<tr><td>'+r[0]+'</td><td>'+(typeof r[1]==='number'?(r[1].toLocaleString('en-US',{maximumFractionDigits:6})):r[1])+'</td></tr>';}).join('')+'</tbody></table>';
 var d=Math.floor(t/86400),wk=Math.floor(d/7),dd=d%7;
 $('du-out').innerHTML='<div class="tl-big">'+human(t)+'</div>'+tbl+
 '<p class="meta">In whole units: '+(wk?wk+' week'+(wk===1?'':'s')+' + ':'')+dd+' day'+(dd===1?'':'s')+' + '+Math.floor(t%86400/3600)+' h — no month row on purpose: months run 28–31 days, so "X months" is always a calendar claim, not an arithmetic one.</p>';}
$('du-go').onclick=render;$('du-in').oninput=render;$('du-unit').onchange=render;render();`,
  seo: `<h2 class="section-title">The three duration mistakes this avoids</h2>
  <p>First: "minutes" typed into a seconds field — the unit selector multiplies explicitly instead of guessing. Second: converting to months/years by dividing by 30 — this page stops at weeks and says why. Third: daylight saving. "48 hours from 23:00 the Saturday before clocks spring forward" is <i>not</i> 23:00 two days later on wall-clock time; a duration of 172,800 seconds is, and the two answers differ by an hour twice a year. Durations are physical; dates are politics.</p>`,
});

// ── 16. /alat/validate — check-digit validator ───────────────────────────────
TOOLKIT.push({
  slug: 'validate', ic: '🧾', name: 'Check Digit Validator',
  title: 'Card, IBAN, ISBN & Barcode Validator — Luhn, Mod-97, Mod-11 | Tukuk-OS',
  desc: 'Validate a card number (Luhn), an IBAN (mod-97), an ISBN-10/13 or an EAN/UPC barcode — the real published algorithms with the working shown, nothing typed leaving your device.',
  hero: 'Check Digit Validator', sub: 'Luhn · IBAN mod-97 · ISBN · EAN — the maths printed, in your browser',
  navBlurb: 'Does this card/IBAN/ISBN/barcode pass its own check digit? The published algorithm, the working printed, and the honest limit: validity is not ownership.',
  hubBlurb: 'test a card, IBAN, ISBN or barcode against its own check digit — the arithmetic shown, and nothing you type goes anywhere',
  lead: 'Four everyday identifiers carry a final digit computed from all the others. This page runs each published algorithm — <b>Luhn</b> (cards), <b>ISO 7064 mod-97</b> (IBAN), <b>mod-11</b> (ISBN-10) and <b>mod-10×3</b> (ISBN-13/EAN/UPC) — and prints the working. One thing it will never claim: a valid check digit means the number is <i>real and yours</i>. It means only that it was built correctly.',
  form: `<div class="tl-form">
  ${field('Standard', '<select id="va-kind"><option value="luhn" selected>Card (Luhn)</option><option value="iban">IBAN (mod-97)</option><option value="isbn13">ISBN-13 / EAN (mod10×3)</option><option value="isbn10">ISBN-10 (mod-11)</option></select>')}
  ${field('Number', '<input id="va-in" type="text" value="4242 4242 4242 4242" autocomplete="off" spellcheck="false" style="min-width:260px">')}
  <button class="tl-btn primary" id="va-go" type="button">Validate</button>
</div>
<div class="tl-res" id="va-out">—</div>`,
  script: `
var $=function(id){return document.getElementById(id);};
function luhnCheck(digits){var sum=0,alt=false;
 for(var i=digits.length-1;i>=0;i--){var d=+digits[i];
  if(alt){d*=2;if(d>9)d-=9;}
  sum+=d;alt=!alt;}
 return {sum:sum,ok:sum%10===0};}
function mod10x3(digits){var sum=0;
 for(var i=0;i<digits.length-1;i++)sum+=+digits[i]*(i%2?3:1);
 var chk=(10-sum%10)%10,work='\u03a3 digit\u00d7weight(1,3,1,3\u2026) over the first 12 = '+sum+'; check = (10 \u2212 ('+sum+' mod 10)) mod 10 = '+chk;
 return {ok:chk===+digits[digits.length-1],expected:chk,work:work};}
function isbn10(s){var sum=0;
 for(var i=0;i<9;i++)sum+=(+s[i])*(10-i);
 var lc=s[9],expected=(11-sum%11)%11;
 return {ok:(lc==='X'?10:+lc)===expected,work:'\u03a3 d\u00d7(10\u2212i) over the first nine digits = '+sum+'; the tenth character must bring the total to a multiple of 11, so it is '+(expected===10?'X':expected)+' \u2014 you wrote '+lc+'.'};}
function ibanCheck(raw){var s=raw.replace(/[ -]/g,'').toUpperCase();
 if(!/^[A-Z]{2}\\d{2}[A-Z0-9]{10,30}$/.test(s))return {err:'IBAN = 2 letters, 2 digits check, then the account string'};
 var moved=s.slice(4)+s.slice(0,4),num='';
 for(var i=0;i<moved.length;i++){var c=moved[i];num+=c>='A'&&c<='Z'?(c.charCodeAt(0)-55):c;}
 var r=BigInt(num)%97n;
 return {ok:r===1n,work:'rearranged BBAN+country+check as digits, mod 97 = '+r+' (must be 1)',country:s.slice(0,2),check:s.slice(2,4)};}
function render(){var kind=$('va-kind').value,raw=$('va-in').value;
 var out=$('va-out');
 if(kind==='iban'){var r=ibanCheck(raw);
  if(r.err){out.innerHTML='<span class="tl-badge tl-no">check input</span> '+r.err;return;}
  out.innerHTML=(r.ok?'<span class="tl-badge tl-ok">VALID</span>':'<span class="tl-badge tl-no">INVALID</span>')+
   '<p class="tl-pick">'+raw.replace(/[ -]/g,'').toUpperCase()+'</p><p>'+r.work+'. Country prefix '+r.country+' — note: the SWIFT/SEPA registry that maps country → expected IBAN length is not reproduced here, so length-plausible formats pass even if the national registry would reject them.</p>';return;}
 var d=raw.replace(/[ -]/g,'').toUpperCase();
 if(kind==='isbn10'){if(!/^\\d{9}[\\dX]$/.test(d)){out.innerHTML='<span class="tl-badge tl-no">check input</span> ISBN-10 is nine digits plus a check character (0\u20139 or X); spaces and hyphens are ignored.';return;}}
 else if(!/^\\d+$/.test(d)){out.innerHTML='<span class="tl-badge tl-no">check input</span> Digits only (spaces and hyphens ignored).';return;}
 var res,big;
 if(kind==='luhn'){
  if(d.length<12||d.length>19){out.innerHTML='<span class="tl-badge tl-no">wrong length</span> Card numbers run 12–19 digits; this has '+d.length+'.';return;}
  res=luhnCheck(d);
  big='<p>Working: double every second digit from the right (subtract 9 when a doubling passes 9), add everything \u2014 sum = '+res.sum+', and '+res.sum+' mod 10 = '+(res.sum%10)+(res.ok?' \u2014 zero is the pass condition':' \u2014 not zero, so a well-formed card number would end differently')+'.</p>';
  out.innerHTML=(res.ok?'<span class="tl-badge tl-ok">VALID</span>':'<span class="tl-badge tl-no">INVALID</span>')+'<p class="tl-pick">'+d+'</p>'+big+'<p class="meta">Prefix tells the network: 4\u2026 Visa, 5[1-5]\u2026 Mastercard, 3[47]\u2026 Amex, 6011/65\u2026 Discover. A valid Luhn number is arithmetically well-formed — it is not proof of existence, and trying to divine one is carding, a crime. This tool checks numbers you already hold.</p>';return;}
 if(kind==='isbn13'){if(d.length!==13){out.innerHTML='<span class="tl-badge tl-no">wrong length</span> ISBN-13/EAN needs exactly 13 digits.';return;}
  res=mod10x3(d);out.innerHTML=(res.ok?'<span class="tl-badge tl-ok">VALID</span>':'<span class="tl-badge tl-no">INVALID</span>')+'<p class="tl-pick">'+d+'</p><p>'+res.work+(res.ok?'':' \u2014 this number\\'s check digit should be '+res.expected)+'</p>';return;}
 if(kind==='isbn10'){var r10=isbn10(d);
  out.innerHTML=(r10.ok?'<span class="tl-badge tl-ok">VALID</span>':'<span class="tl-badge tl-no">INVALID</span>')+'<p class="tl-pick">'+d+'</p><p>'+r10.work+'</p><p class="meta">Since 2007 new books carry ISBN-13; 978-prefix ISBN-10s are bar-code conversions of the same number.</p>';return;}}
$('va-go').onclick=render;$('va-in').oninput=render;$('va-kind').onchange=render;render();`,
  seo: `<h2 class="section-title">What a check digit can and cannot tell you</h2>
  <p>These digits catch <i>typos</i>, not fraud: Luhn catches any single-digit error and most transpositions; mod-97 catches essentially every single-character error and most two-character ones. They were designed in an age when the hostile act was a mistyped slip, not an adversarial forgery — and a check digit cannot stop anyone who computes it, which is why no payment system accepts a number on Luhn alone. For IBANs, SEPA additionally demands the country-specific length and BBAN shape; a real transfer validates against the issuer, and the fee message you get back is the only thing that ever proves an account exists.</p>`,
});

// ── 17. /alat/unitprice — price per unit comparison ──────────────────────
TOOLKIT.push({
  slug: 'unitprice', ic: '\ud83d\uded2', name: 'Unit Price Comparison',
  title: 'Unit Price Calculator \u2014 Which Packet Is Actually Cheaper? | Tukuk-OS',
  desc: 'Compare two products by price per gram, ml, piece or square metre: the cheaper rate, how much cheaper, and what the rival pack would cost at that rate. Browser-local.',
  hero: 'Unit Price Comparison', sub: 'per g \u00b7 ml \u00b7 piece \u00b7 m\u00b2 \u2014 the shelf-label question, answered',
  navBlurb: 'The 500\u202fg vs 1\u202fkg decision settled by price per unit, with the percentage gap and what the other pack would cost at the winner\u2019s rate.',
  hubBlurb: 'two packets, one truth: the cheaper-per-gram option, by how much, and what the other would have to cost to match',
  lead: 'Supermarket shelf labels answer one question \u2014 <b>cost per standard amount</b> \u2014 and this page does the same for the two products in your hands. Enter both sizes in the same unit (the kg and litre options scale by 1000 for you). One thing maths cannot see: a family-size pack you throw away half of is not a bargain, so the verdict is about rates, not about your fridge.',
  form: `<div class="tl-form">
  ${field('Compare as', '<select id="up-unit"><option value="g" selected>grams \u2014 sizes in g</option><option value="kg">grams \u2014 sizes in kg</option><option value="ml">ml \u2014 sizes in ml</option><option value="l">ml \u2014 sizes in litres</option><option value="ea">per piece</option><option value="m2">per m\u00b2</option></select>')}
  ${field('A \u00b7 price', '<input id="up-ap" type="number" min="0" step="0.01" value="4.99">')}
  ${field('A \u00b7 size', '<input id="up-aq" type="number" min="0.0001" step="any" value="500">')}
  ${field('B \u00b7 price', '<input id="up-bp" type="number" min="0" step="0.01" value="8.50">')}
  ${field('B \u00b7 size', '<input id="up-bq" type="number" min="0.0001" step="any" value="1000">')}
  <button class="tl-btn primary" id="up-go" type="button">Compare</button>
</div>
<div class="tl-res" id="up-out">\u2014</div>`,
  script: `
var $=function(id){return document.getElementById(id);};
function money(x){return '$'+x.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:5});}
var SCALE={g:1,kg:1000,ml:1,l:1000,ea:1,m2:1};
var BASE={g:'g',kg:'g',ml:'ml',l:'ml',ea:'piece',m2:'m\u00b2'};
function render(){var u=$('up-unit').value,k=SCALE[u],base=BASE[u];
 var ap=parseFloat($('up-ap').value),aq=(parseFloat($('up-aq').value)||0)*k;
 var bp=parseFloat($('up-bp').value),bq=(parseFloat($('up-bq').value)||0)*k;
 if(!(ap>0)||!(aq>0)||!(bp>0)||!(bq>0)){$('up-out').innerHTML='<span class="tl-badge tl-no">check inputs</span> Both products need a positive price and size.';return;}
 var pa=ap/aq,pb=bp/bq;
 var same=Math.abs(pa-pb)<1e-12;
 if(same){$('up-out').innerHTML='<div class="tl-big">same rate</div><p class="meta">Both cost '+money(pa)+' per '+base+' \u2014 pick the size you will actually use before it turns.</p>';return;}
 var cheap=pa<pb?'A':'B',dear=pa<pb?'B':'A';
 var pc=Math.min(pa,pb),pd=Math.max(pa,pb);var pct=(pd-pc)/pd*100;
 var dearQty=dear==='A'?aq:bq;
 $('up-out').innerHTML='<div class="tl-big">'+cheap+' by '+pct.toFixed(1)+'%</div>'+
 '<table class="tl-tab"><tbody>'+
 '<tr><td>A: '+aq.toLocaleString('en-US')+' '+base+' for '+money(ap)+'</td><td>'+money(pa)+' / '+base+'</td></tr>'+
 '<tr><td>B: '+bq.toLocaleString('en-US')+' '+base+' for '+money(bp)+'</td><td>'+money(pb)+' / '+base+'</td></tr>'+
 '<tr><td>Cheaper rate</td><td>'+money(pc)+' per '+base+' ('+cheap+')</td></tr>'+
 '<tr><td>'+dear+' at '+cheap+'\u2019s rate would cost</td><td>'+money(pc*dearQty)+'</td></tr>'+
 '</tbody></table><p class="meta">$ shown for readability \u2014 the comparison is unitless. \u201c'+pct.toFixed(1)+'% cheaper\u201d is measured against the dearer rate, which is how the phrase should be read.</p>';}
$('up-go').onclick=render;$('up-ap').oninput=render;$('up-aq').oninput=render;$('up-bp').oninput=render;$('up-bq').oninput=render;$('up-unit').onchange=render;render();`,
  seo: `<h2 class="section-title">Why the bigger pack is not always the better buy</h2>
  <p>Unit-price gaps shrink near round sizes, and the maths stays honest either way: 4.99/500\u202fg against 8.50/1\u202fkg is a real 14.8% saving per gram, but the same algorithm run on two packs within a cent of each other just says \u201csame rate\u201d. Waste is a unit price too \u2014 at those rates, a 25%-cheaper kilo you end up composting costs far more than the pack you finish.</p>`,
});

// ── 18. /alat/fuel — fuel economy ─────────────────────────────────────────────
TOOLKIT.push({
  slug: 'fuel', ic: '\u26fd', name: 'Fuel Economy Calculator',
  title: 'Fuel Consumption Calculator \u2014 L/100\u202fkm, km/L and Cost per Distance | Tukuk-OS',
  desc: 'Turn trip distance, fuel used and price into L/100\u202fkm, km/L, US MPG and the cost per 100\u202fkm and per trip \u2014 both consumption traditions shown. In your browser.',
  hero: 'Fuel Economy', sub: 'L/100\u202fkm \u21c4 km/L \u21c4 MPG \u00b7 cost per 100 \u00b7 your trip, one division',
  navBlurb: 'The pump-and-odometer maths both traditions ask for \u2014 L/100\u202fkm and km/L and US MPG \u2014 plus what the trip actually cost.',
  hubBlurb: '480 km on 30 litres: 6.25\u202fL/100\u202fkm, 16\u202fkm/L, 37.6 US MPG \u2014 and the cost per 100\u202fkm at your pump price',
  lead: 'Two countries measure the same car in opposite directions: Europe divides fuel by distance (L/100\u202fkm \u2014 <i>smaller is better</i>), the US and UK divide distance by fuel (MPG \u2014 <i>bigger is better</i>). This page prints both from the same three numbers, because mixing them up is the single most common fuel-economy error \u2014 and the two scales are reciprocals, which are not linear: dropping from 10 to 5\u202fL/100\u202fkm saves far more fuel than dropping from 5 to 2.5.',
  form: `<div class="tl-form">
  ${field('Distance', '<input id="fu-km" type="number" min="0.1" step="any" value="480">')}
  <span class="meta">km</span>
  ${field('Fuel used', '<input id="fu-l" type="number" min="0.01" step="any" value="30">')}
  <span class="meta">litres</span>
  ${field('Price per litre', '<input id="fu-p" type="number" min="0" step="0.01" value="1.85">')}
  <button class="tl-btn primary" id="fu-go" type="button">Calculate</button>
</div>
<div class="tl-res" id="fu-out">\u2014</div>`,
  script: `
var $=function(id){return document.getElementById(id);};
function money(x){return '$'+x.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});}
function fmt(x,d){return x.toLocaleString('en-US',{maximumFractionDigits:d==null?2:d});}
var USGAL=3.785411784,MILE=1.609344;
function render(){var km=parseFloat($('fu-km').value),l=parseFloat($('fu-l').value),p=parseFloat($('fu-p').value)||0;
 if(!(km>0)||!(l>0)){$('fu-out').innerHTML='<span class="tl-badge tl-no">check inputs</span> Distance and fuel must both be positive.';return;}
 var lp100=l/km*100,kml=km/l,mpg=kml*USGAL/MILE;
 $('fu-out').innerHTML='<div class="tl-big">'+fmt(lp100)+' L/100\u202fkm</div>'+
 '<table class="tl-tab"><tbody>'+
 '<tr><td>km per litre</td><td>'+fmt(kml)+' km/L</td></tr>'+
 '<tr><td>US miles per gallon</td><td>'+fmt(mpg,1)+' MPG</td></tr>'+
 '<tr><td>UK (imperial) miles per gallon</td><td>'+fmt(mpg*1.20094,1)+' MPG</td></tr>'+
 '<tr><td>Cost per 100\u202fkm</td><td>'+money(lp100*p)+'</td></tr>'+
 '<tr><td>Cost of this '+fmt(km,0)+'\u202fkm trip</td><td>'+money(l*p)+'</td></tr>'+
 '<tr><td>CO\u2082 (~2.31\u202fkg per litre)</td><td>~'+fmt(l*2.31,1)+'\u202fkg</td></tr>'+
 '</tbody></table><p class="meta">Recalculate with the tank\u2019s real fill-to-fill figures (same pump, same run) \u2014 top-ups after a dry tank understate consumption. Currency shown as $; the maths is unitless.</p>';}
$('fu-go').onclick=render;$('fu-km').oninput=render;$('fu-l').oninput=render;$('fu-p').oninput=render;render();`,
  seo: `<h2 class="section-title">The UK gallon, and why this page flags it</h2>
  <p>The imperial gallon is 4.54609\u202fl, not the US 3.78541\u202fl \u2014 20.1% more \u2014 so a \u201c40\u202fMPG\u201d car in a British review is 33.3\u202fMPG by American numbers. Rather than guess which MPG you meant, this page labels both. And before comparing your figure against a brochure: advertised consumption is measured on a different track than your road (literally \u2014 WLTP runs warmer, lighter and unloaded), so expect real numbers 15\u201330% above the sticker.</p>`,
});

// ── 19. /alat/sleep — sleep-cycle calculator ──────────────────────────────────
TOOLKIT.push({
  slug: 'sleep', ic: '\ud83d\ude34', name: 'Sleep-Cycle Calculator',
  title: 'Sleep Cycle Calculator \u2014 Bedtimes for 90-Minute Cycles | Tukuk-OS',
  desc: 'Work out the best times to fall asleep for your wake-up, using 90-minute sleep cycles and ~15 minutes to drop off \u2014 six cycles down to four. In your browser.',
  hero: 'Sleep-Cycle Calculator', sub: '90-min cycles \u00b7 6\u202f\u00b7 5\u202f\u00b7 4 \u00b7 wake at the top of a cycle',
  navBlurb: 'The napkin maths of sleep: count back in 90-minute cycles from your alarm and see which bedtimes wake you mid-cycle-free.',
  hubBlurb: 'alarm at 06:30? be asleep by 21:15, 22:45 or 00:15 \u2014 the cycle model, the maths shown, no medical claims',
  lead: 'Sleep runs in cycles of roughly 90 minutes; waking <i>inside</i> deep sleep is the grogginess people blame on \u201clacking sleep\u201d. This page counts back from your alarm in whole cycles (6\u202f\u00d7\u202f90 = 9\u202fh, 5\u202f\u00d7\u202f90 = 7.5\u202fh, 4\u202f\u00d7\u202f90 = 6\u202fh) and adds about 15 minutes to fall asleep. The honest caveat is printed with every answer: real cycle length varies 70\u2013120 minutes between people and nights, so this is a good model, not a measurement \u2014 and it makes no medical claim.',
  form: `<div class="tl-form">
  ${field('I want to', '<select id="sl-mode"><option value="wake" selected>wake at \u2026 (show bedtimes)</option><option value="bed">fall asleep at \u2026 (show alarms)</option></select>')}
  ${field('Time', '<input id="sl-time" type="time" value="06:30">')}
  <button class="tl-btn primary" id="sl-go" type="button">Calculate</button>
</div>
<div class="tl-res" id="sl-out">\u2014</div>`,
  script: `
var $=function(id){return document.getElementById(id);};
var FALL=15,CY=90;
function hhmm(min){min=((min%1440)+1440)%1440;var h=Math.floor(min/60),m=min%60;return (h<10?'0':'')+h+':'+(m<10?'0':'')+m;}
function render(){var v=$('sl-time').value;
 if(!/^\\d{1,2}:\\d{2}$/.test(v)){$('sl-out').innerHTML='<span class="tl-badge tl-no">check input</span> Pick a time on the clock.';return;}
 var parts=v.split(':'),t=(+parts[0])*60+(+parts[1]);
 var to=$('sl-mode').value==='wake';
 var rows=[[6,'9\u202fh \u2014 the full night'],[5,'7\u202fh 30\u202fm \u2014 the standard adult target'],[4,'6\u202fh \u2014 the short-but-clean option']];
 var html='<table class="tl-tab"><tbody>';
 rows.forEach(function(r){var off=r[0]*CY+FALL;
  var time=to?hhmm(t-off):hhmm(t+off);
  html+='<tr><td>'+r[0]+' cycles \u00b7 '+r[1]+'</td><td>'+(to?'sleep by <b>'+time+'</b>':'alarm at <b>'+time+'</b>')+'</td></tr>';});
 $('sl-out').innerHTML=html+'</tbody></table>'+'<p class="meta">Model: cycles of '+CY+'\u202fmin + '+FALL+'\u202fmin to fall asleep. Waking at the <i>end</i> of a cycle avoids the deep-sleep alarm; but real cycles run 70\u2013120\u202fmin and shift through the night, so treat the nearest slot, not the exact minute, as the advice. No medical claim \u2014 chronic tiredness is a doctor topic, not a clock topic.</p>';}
$('sl-go').onclick=render;$('sl-time').oninput=render;$('sl-mode').onchange=render;render();`,
  seo: `<h2 class="section-title">Where the 90 minutes comes from</h2>
  <p>Measured polysomnography cycles \u2014 light sleep, deep sleep, REM \u2014 average close to 90 minutes in adults, first appearing in sleep research of the 1970s. The average is the point: your personal mean may be 80 or 100, and the model cannot know it without data. If the predicted wake-times consistently feel wrong by the same amount, that offset <i>is</i> your personal cycle length \u2014 nudge the math by it rather than trusting 90 forever.</p>`,
});

// ── 20. /alat/lorem — lorem ipsum generator ──────────────────────────────
TOOLKIT.push({
  slug: 'lorem', ic: '\ud83d\udcdd', name: 'Lorem Ipsum Generator',
  title: 'Lorem Ipsum Generator \u2014 Real Cicero, Not Character Salad | Tukuk-OS',
  desc: 'Placeholder text with correct Latin quantities, from one paragraph to twenty, optionally opening with the classic \u201cLorem ipsum dolor sit amet\u201d. Browser-local.',
  hero: 'Lorem Ipsum Generator', sub: 'grammatically fake, structurally real \u00b7 1\u201320 paragraphs',
  navBlurb: 'Proper placeholder text \u2014 scrambled from the real De\u202fFinibus word bank, variable sentence lengths, no \u201casdfgh\u201d filler.',
  hubBlurb: 'the industry\u2019s placeholder text, generated honestly: pseudo-Latin from the actual Cicero word bank, in as many paragraphs as your mockup needs',
  lead: 'Lorem ipsum is not random letters: it descends from a scrambled passage of Cicero\u2019s <i>De\u202fFinibus\u202fBonorum\u202fet\u202fMalorum</i> (45\u202fBC) and has set type since the 1500s. Cheap generators ignore that and emit character salad that reads obviously fake at a glance \u2014 which defeats the entire purpose of placeholder text (<i>making the layout look real without the words competing with it</i>). This one draws from the real word bank with Latin-plausible sentence structure, and is transparent about being gibberish if you translate it.',
  form: `<div class="tl-form">
  ${field('Paragraphs', '<input id="lo-n" type="number" min="1" max="20" step="1" value="3">')}
  <label style="display:flex;align-items:center;gap:8px"><input id="lo-classic" type="checkbox" checked> open with \u201cLorem ipsum dolor sit amet\u2026\u201d</label>
  <button class="tl-btn primary" id="lo-go" type="button">Generate</button>
</div>
<div class="tl-res" id="lo-out">\u2014</div>`,
  script: `
var $=function(id){return document.getElementById(id);};
var WORDS=['lorem','ipsum','dolor','sit','amet','consectetur','adipiscing','elit','sed','do','eiusmod','tempor','incididunt','ut','labore','et','dolore','magna','aliqua','enim','ad','minim','veniam','quis','nostrud','exercitation','ullamco','laboris','nisi','aliquip','ex','ea','commodo','consequat','duis','aute','irure','in','reprehenderit','voluptate','velit','esse','cillum','eu','fugiat','nulla','pariatur','excepteur','sint','occaecat','cupidatat','non','proident','sunt','culpa','qui','officia','deserunt','mollit','anim','id','est','laborum','quasi','architecto','beatae','vitae','dicta','explicabo','nemo','ipsam','quia','voluptatem','accusantium','rem','provident','corrupti','quos','dolores','eos','rationum','sequi','nesciunt','neque','porro','quisquam','dignissimos','ducimus','blanditiis','praesentium','voluptatum','deleniti','atque','tenatur','sapiente','maiores','repudiandae','molestiae','consequatur','aut','illum','iste','natus','error','voluptates','recusandae','quas'];
var OPEN='Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.';
function make(seed){var s=seed>>>0||1;return function(){s^=s<<13;s>>>=0;s^=s>>>17;s^=s<<5;s>>>=0;return s/4294967296;};}
function sentence(r){var len=6+Math.floor(r()*14),out=WORDS[Math.floor(r()*WORDS.length)];
 for(var i=1;i<len;i++)out+=(r()<0.18?', ':' ')+WORDS[Math.floor(r()*WORDS.length)];
 return out.charAt(0).toUpperCase()+out.slice(1)+(r()<0.12?'!':'.');}
function render(){var n=Math.min(20,Math.max(1,Math.round(parseFloat($('lo-n').value)||3)));
 var seed=Date.now()>>>0,r=make(seed),paras=[];
 for(var p=0;p<n;p++){var sent=[];
  if(p===0&&$('lo-classic').checked)sent.push(OPEN);
  var count=3+Math.floor(r()*4);
  for(var i=0;i<count;i++)sent.push(sentence(r));
  paras.push(sent.join(' '));}
 $('lo-out').innerHTML='<p class="meta" style="margin-top:0">seed '+(seed%100000)+' \u00b7 press Generate again for fresh text</p>'+
  paras.map(function(t){return '<blockquote class="tl-pick" style="display:block;margin:0 0 10px">'+t+'</blockquote>';}).join('');}
$('lo-go').onclick=render;$('lo-n').oninput=render;$('lo-classic').onchange=render;render();`,
  seo: `<h2 class="section-title">A 2,000-year-old placeholder</h2>
  <p>The text comes from section 1.32\u20131.33 of Cicero\u2019s De\u202fFinibus, on ethical hedonism \u2014 which makes lorem ipsum, ironically, about pleasure. Typesetters scrambled it to keep eyes off the words; in the 1960s Letraset sheets carried it, and desktop publishing made it universal. Keeping that tradition honest means fake Latin with real <i>shape</i>: variable sentence lengths, clause commas, paragraph openings \u2014 the properties a mockup needs from text, without any readable content stealing attention from the design.</p>`,
});

// ── 21. /alat/aspect — aspect ratio calculator ────────────────────────────
TOOLKIT.push({
  slug: 'aspect', ic: '\ud83d\udcd0', name: 'Aspect Ratio Calculator',
  title: 'Aspect Ratio Calculator \u2014 Simplify, Resize and Compare | Tukuk-OS',
  desc: 'Reduce any width \u00d7 height to its simplest ratio, name the nearest standard (16:9, 4:3, 3:2, 21:9\u2026), fit it inside a box, and scale both sides by a percentage. Browser-local.',
  hero: 'Aspect Ratio Calculator', sub: 'simplify \u00b7 nearest standard \u00b7 fit inside a box \u00b7 exact scaling',
  navBlurb: 'Turn 1920\u00d71080 into 16:9, check what a crop actually is, and resize to fit any box with the rounding error printed.',
  hubBlurb: 'the ratio behind your screenshot, simplified by Euclid\u2019s algorithm, matched to the nearest standard, fitted into any box',
  lead: 'Three jobs done exactly once: <b>simplify</b> a width \u00d7 height by their greatest common divisor (Euclid, ~300\u202fBC, still the right algorithm), <b>name</b> the nearest common format with the true percentage difference shown so you can see when \u201c16:9\u201d is actually 1.9% off, and <b>fit</b> the frame inside a maximum box using whichever side runs out first \u2014 the way every real image resizer works.',
  form: `<div class="tl-form">
  ${field('Width', '<input id="as-w" type="number" min="1" step="1" value="1920">')}
  ${field('Height', '<input id="as-h" type="number" min="1" step="1" value="1080">')}
  ${field('Fit inside', '<input id="as-fw" type="number" min="1" step="1" value="800">')}
  ${field('\u00d7', '<input id="as-fh" type="number" min="1" step="1" value="600">')}
  <button class="tl-btn primary" id="as-go" type="button">Calculate</button>
</div>
<div class="tl-res" id="as-out">\u2014</div>`,
  script: `
var $=function(id){return document.getElementById(id);};
function gcd(a,b){a=Math.abs(a);b=Math.abs(b);while(b){var t=a%b;a=b;b=t;}return a;}
var STD=[[16,9],[4,3],[3,2],[21,9],[1,1],[16,10],[5,4],[32,9],[2,3],[9,16]];
function render(){var w=Math.round(parseFloat($('as-w').value)),h=Math.round(parseFloat($('as-h').value));
 var fw=Math.round(parseFloat($('as-fw').value)),fh=Math.round(parseFloat($('as-fh').value));
 if(!(w>0)||!(h>0)){$('as-out').innerHTML='<span class="tl-badge tl-no">check inputs</span> Width and height need positive whole numbers (pixels are whole).';return;}
 var g=gcd(w,h)||1,rw=w/g,rh=h/g;
 var r=w/h,best=null,bd=1e9;
 STD.forEach(function(s){var d=Math.abs(s[0]/s[1]-r);if(d<bd){bd=d;best=s;}});
 var dpct=(r/(best[0]/best[1])-1)*100;
 var rows='<tr><td>Simplified ratio</td><td>'+rw+':'+rh+'</td></tr>'+
  '<tr><td>As a decimal</td><td>'+r.toFixed(4)+'</td></tr>'+
  '<tr><td>Nearest standard</td><td>'+best[0]+':'+best[1]+' \u00b7 '+(Math.abs(dpct)<0.005?'exact':'the real frame is '+Math.abs(dpct).toFixed(1)+'% '+(dpct>0?'wider':'narrower'))+'</td></tr>'+
  '<tr><td>Orientation</td><td>'+(w>h?'landscape \u2014 '+fmt(w)+'\u00d7'+fmt(h):w<h?'portrait \u2014 '+fmt(w)+'\u00d7'+fmt(h):'square \u2014 '+fmt(w)+'\u00d7'+fmt(h))+'</td></tr>'+
  '<tr><td>Megapixels</td><td>'+(w*h/1e6).toFixed(2)+' MP</td></tr>';
 if(fw>0&&fh>0){var s=Math.min(fw/w,fh/h);var sw2=Math.round(w*s),sh2=Math.round(h*s);
  rows+='<tr><td>Largest fit inside '+fmt(fw)+'\u00d7'+fmt(fh)+'</td><td>'+fmt(sw2)+'\u00d7'+fmt(sh2)+' ('+(s*100).toFixed(1)+'%)</td></tr>';}
 $('as-out').innerHTML='<div class="tl-big">'+best[0]+':'+best[1]+'</div><table class="tl-tab"><tbody>'+rows+'</tbody></table><p class="meta">The simplified ratio is exact (Euclid\u2019s gcd); \u201cnearest standard\u201d compares the decimal ratio, and the percentage tells you when your frame only looks like 16:9.</p>';}
function fmt(n){return n.toLocaleString('en-US');}
$('as-go').onclick=render;$('as-w').oninput=render;$('as-h').oninput=render;$('as-fw').oninput=render;$('as-fh').oninput=render;render();`,
  seo: `<h2 class="section-title">Why 1920\u00d71080 is exactly 16:9 but 1280\u00d7720 feels the same</h2>
  <p>They reduce to the same fraction \u2014 16/9 \u2014 which is the entire content of the phrase \u201csame aspect ratio\u201d: identical shape, different size. Resolution adds pixels; ratio only shapes them. That is why a 16:9 video letterboxes on a 16:10 laptop with black bars top and bottom (the shapes genuinely differ by 5.6% of height) and why \u201cfullscreen\u201d either crops the edges or stretches faces. The gcd on this page is the same reduction your maths teacher used for fractions \u2014 Euclid, Elements VII, still the fastest way to it after 2,300 years.</p>`,
});

// ── 22. /alat/cssunits — CSS unit converter ──────────────────────────────
TOOLKIT.push({
  slug: 'cssunits', ic: '\ud83d\udccf', name: 'CSS Unit Converter',
  title: 'CSS Unit Converter \u2014 px, rem, pt and % With Your Real Root Size | Tukuk-OS',
  desc: 'Convert between px, rem, pt and a percentage of the root font size using your actual 16\u202fpx (or chosen) root \u2014 with the em ambiguity explained, not silently guessed.',
  hero: 'CSS Unit Converter', sub: 'px \u21c4 rem \u21c4 pt \u21c4 % \u00b7 your root size \u00b7 em left honest',
  navBlurb: 'px to rem to pt with your real root font size, and an honest note about the one unit (em) that depends on context this page cannot see.',
  hubBlurb: '24\u202fpx is 1.5\u202frem at a 16\u202fpx root \u2014 the whole conversion table, with the em footgun explained instead of fake-converted',
  lead: 'One input value, every unit it equals, at the root font size you choose (default 16\u202fpx, the CSS spec\u2019s initial value). <b>pt</b> is CSS\u2019s print unit \u2014 defined as 1/72\u202finch at 96\u202fdpi, so 1\u202fpt = 4/3\u202fpx exactly. <b>rem</b> is simply value \u00f7 root size. And <b>em</b> is deliberately <i>not</i> in the table: em resolves against the element\u2019s <i>own</i> inherited font size, which a converter on a website cannot know \u2014 the note under the table gives the one rule that keeps em from biting you.',
  form: `<div class="tl-form">
  ${field('Value', '<input id="cu-v" type="number" step="any" value="24">')}
  ${field('From', '<select id="cu-u"><option value="px" selected>px</option><option value="rem">rem</option><option value="pt">pt</option><option value="pct">% of root</option></select>')}
  ${field('Root font size', '<input id="cu-r" type="number" min="8" max="32" step="0.5" value="16">')}
  <span class="meta">px</span>
  <button class="tl-btn primary" id="cu-go" type="button">Convert</button>
</div>
<div class="tl-res" id="cu-out">\u2014</div>`,
  script: `
var $=function(id){return document.getElementById(id);};
function num(x){return x.toLocaleString('en-US',{maximumFractionDigits:4});}
function render(){var v=parseFloat($('cu-v').value),u=$('cu-u').value,root=parseFloat($('cu-r').value);
 if(!isFinite(v)){ $('cu-out').innerHTML='<span class="tl-badge tl-no">check input</span> Enter a number \u2014 negative sizes are legal in CSS, NaN is not.';return;}
 if(!(root>0)){ $('cu-out').innerHTML='<span class="tl-badge tl-no">check root</span> Root size must be positive.';return;}
 var px;
 if(u==='px')px=v;
 else if(u==='rem')px=v*root;
 else if(u==='pt')px=v*96/72;
 else px=v/100*root;
 var rows=[['px',num(px)+' px'],['rem',num(px/root)+' rem'],['pt',num(px*72/96)+' pt'],['% of root',num(px/root*100)+'%'],['inches (CSS: 96 per inch)',num(px/96)+' in']];
 $('cu-out').innerHTML='<div class="tl-big">'+num(px)+' px</div>'+
 '<table class="tl-tab"><tbody>'+rows.map(function(r){return '<tr><td>'+r[0]+'</td><td>'+r[1]+'</td></tr>';}).join('')+'</tbody></table>'+
 '<p class="meta">No em row on purpose: em multiplies the element\u2019s <i>inherited</i> font size, so 2\u202fem means 32\u202fpx on a 16\u202fpx body and 24\u202fpx inside a 12\u202fpx caption \u2014 a page like this one converting it \u201cfor you\u201d would be guessing. Rule of thumb: rem for global scale, em for padding/sizes that should track the component\u2019s own text.</p>';}
$('cu-go').onclick=render;$('cu-v').oninput=render;$('cu-u').onchange=render;$('cu-r').oninput=render;render();`,
  seo: `<h2 class="section-title">The pt is not the Word \u201cpoint\u201d you know</h2>
  <p>DTP uses 72\u202fpt = 1\u202finch and print measures at ~72\u202f\u201cdpi\u201d, so 12\u202fpt looked the same size on screen and paper. CSS kept the unit but anchored it to the screen: a CSS inch is 96\u202fpx, a CSS pt is 4/3\u202fpx \u2014 so 12\u202fpt renders as 16\u202fpx, which is why browsers\u2019 default text size is 16\u202fpx and is called \u201cmedium\u201d in the spec. When a design tool\u2019s pt and your stylesheet\u2019s pt disagree by a third, this is the disagreement. For web work px and rem cover almost everything; pt earns its place only in @media print.</p>`,
});

// ── 23. /alat/dice — dice probability ──────────────────────────────────────
TOOLKIT.push({
  slug: 'dice', ic: '\ud83c\udfb2', name: 'Dice Probability',
  title: 'Dice Probability Calculator \u2014 Exact Odds for Any Dice Pool | Tukuk-OS',
  desc: 'Exact probability of rolling equal to or at least a target sum with 2\u201310 dice of any sides \u2014 every outcome counted by big-integer convolution, not simulated.',
  hero: 'Dice Probability', sub: '2\u201310 dice \u00b7 any sides \u00b7 exact counts, never a simulation',
  navBlurb: 'The true 2d6 curve computed as exact counts \u2014 21 of 36 outcomes are 7 or better \u2014 with the full distribution as a table.',
  hubBlurb: 'exact dice odds by convolution over every outcome \u2014 not a Monte Carlo guess \u2014 up to 10d20, with the full curve shown',
  lead: 'A dice pool has sides^dice outcomes \u2014 10d20 is 10<sup>13</sup>, all countable exactly with integer arithmetic, which is what this page does: convolve one die at a time and read off the counts. No randomness, no simulation error, and the percentages are true fractions of the count, so the answer cannot change between visits. The mean and most-likely total come out of the same table.',
  form: `<div class="tl-form">
  ${field('Dice', '<input id="di-n" type="number" min="2" max="10" step="1" value="2">')}
  ${field('Sides per die', '<input id="di-s" type="number" min="2" max="20" step="1" value="6">')}
  ${field('Target sum', '<input id="di-t" type="number" min="2" step="1" value="7">')}
  <button class="tl-btn primary" id="di-go" type="button">Calculate</button>
</div>
<div class="tl-res" id="di-out">\u2014</div>`,
  script: `
var $=function(id){return document.getElementById(id);};
function render(){var n=Math.round(parseFloat($('di-n').value)),s=Math.round(parseFloat($('di-s').value)),t=Math.round(parseFloat($('di-t').value));
 var out=$('di-out');
 if(!(n>=2&&n<=10)||!(s>=2&&s<=20)){out.innerHTML='<span class="tl-badge tl-no">check inputs</span> 2\u201310 dice, 2\u201320 sides \u2014 beyond that the table still works but your browser waits.';return;}
 var lo=n,hi=n*s;
 if(!(t>=lo&&t<=hi)){out.innerHTML='<span class="tl-badge tl-no">impossible target</span> '+n+'d'+s+' totals run '+lo+'\u2013'+hi+'; '+t+' cannot happen (probability 0 \u2014 say it with confidence).';return;}
 var dp=[],k;for(k=0;k<=hi;k++)dp[k]=0n;dp[0]=1n;
 for(var d=0;d<n;d++){var nd=[];for(k=0;k<=hi;k++)nd[k]=0n;
  for(var sum=d;sum<=s*d;sum++){var c=dp[sum];if(c===0n)continue;
   for(var face=1;face<=s;face++)nd[sum+face]=nd[sum+face]+c;}
  dp=nd;}
 var totaln=0n,ge=0n,mode=lo,mc=-1n;
 for(k=lo;k<=hi;k++){totaln+=dp[k];if(k>=t)ge+=dp[k];if(dp[k]>mc){mc=dp[k];mode=k;}}
 var eq=dp[t];
 function pct(x){return (Number(x)/Number(totaln)*100).toFixed(2)+'%';}
 var full=hi-lo<=40,rows2='';
 for(k=lo;k<=hi;k++){if(!full&&Math.abs(k-t)>4)continue;
  var bar='';var cells=Math.round(Number(dp[k])/Number(totaln)*240);
  for(var b=0;b<cells;b++)bar+='\u2587';
  rows2+='<tr><td'+(k===t?' style="font-weight:700"':'')+'>'+k+'</td><td>'+Number(dp[k]).toLocaleString('en-US')+'</td><td>'+pct(dp[k])+'</td><td style="opacity:.7">'+bar+'</td></tr>';}
 out.innerHTML='<div class="tl-big">'+pct(ge)+' <span class="meta" style="font-size:1rem">for \u2265 '+t+'</span></div>'+
  '<table class="tl-tab"><tbody>'+
  '<tr><td>Outcomes counted</td><td>'+Number(totaln).toLocaleString('en-US')+' (= '+s+'^'+n+')</td></tr>'+
  '<tr><td>P(exactly '+t+')</td><td>'+pct(eq)+' \u00b7 '+Number(eq).toLocaleString('en-US')+' ways</td></tr>'+
  '<tr><td>P(at least '+t+')</td><td>'+pct(ge)+'</td></tr>'+
  '<tr><td>P(at most '+t+')</td><td>'+pct(totaln-ge+eq)+'</td></tr>'+
  '<tr><td>Mean total</td><td>'+(n*(s+1)/2)+'</td></tr>'+
  '<tr><td>Most likely total</td><td>'+mode+' \u00b7 '+pct(mc)+'</td></tr>'+
  '</tbody></table>'+
  '<p class="meta">Distribution '+(full?'of every total:':'near the target \u2014 the full '+lo+'\u2013'+hi+' spread is too wide to print:')+'</p>'+
  '<table class="tl-tab"><thead><tr><th>Total</th><th style="text-align:right">Ways</th><th style="text-align:right">Prob.</th><th></th></tr></thead><tbody>'+rows2+'</tbody></table>'+
  '<p class="meta">Counts are exact integers \u2014 one die convolved at a time \u2014 so the percentages never change between visits, unlike a simulation.</p>';}
$('di-go').onclick=render;$('di-n').oninput=render;$('di-s').oninput=render;$('di-t').oninput=render;render();`,
  seo: `<h2 class="section-title">Why the curve peaks where it does</h2>
  <p>A total is not an outcome — it is a <i>set</i> of outcomes, and the middle of the range has the most ways to be built: 7 on 2d6 arrives six ways (1+6 through 6+1) while 2 and 12 arrive once each, so the counts form a triangle that rounds toward a bell as dice pile up (the central limit theorem, arriving at a board-game table). The “at least” column is what game rules usually need: P(\u2265\u202f7) on 2d6 is 21/36\u202f=\u202f58.33%, not 50%, because the peak itself counts — the same asymmetry that makes 7 both the most-rolled total and the number gamblers pay you to avoid.</p>`,
});

// ── 24. /alat/download — download time estimator ────────────────────────
TOOLKIT.push({
  slug: 'download', ic: '\u23ec', name: 'Download Time Calculator',
  title: 'Download Time Calculator \u2014 File Size \u00f7 Connection Speed | Tukuk-OS',
  desc: 'How long will this file take: size in MB/GB against Mbps or MB/s, with the 8-bits-per-byte trap, decimal-vs-binary sizes, and a realistic 85% line row.',
  hero: 'Download Time Calculator', sub: 'size \u00f7 throughput \u00b7 bits vs bytes shown \u00b7 85% reality row',
  navBlurb: 'The two-minute question answered twice: theoretical minimum and the 85%-of-line-rate figure ISPs actually let you have.',
  hubBlurb: '4.7\u202fGB at 100\u202fMbps is 6\u202fmin 16\u202fs, not 38 \u2014 the bits/bytes and decimal/binary traps both handled, plus a realistic row',
  lead: 'One division answers it \u2014 but only after two traps: <b>speeds are advertised in bits</b> (Mbps) while <b>files are measured in bytes</b> (\u00d78 apart), and a \u201c1\u202fGB\u201d is 10\u2079 bytes to the shop but 2\u00b3\u2070 to your operating system. The page prints the theoretical figure and a realistic one at 85% of line rate, because TCP, TLS and disk writes never run at spec.',
  form: `<div class="tl-form">
  ${field('File size', '<input id="dn-size" type="number" min="0.001" step="any" value="4.7">')}
  ${field('', '<select id="dn-sz"><option value="KB">KB</option><option value="MB">MB</option><option value="GB" selected>GB</option><option value="TB">TB</option></select>')}
  ${field('Connection', '<input id="dn-rate" type="number" min="1" step="any" value="100">')}
  ${field('', '<select id="dn-rt"><option value="Mbps" selected>Mbps (bits)</option><option value="MBps">MB/s (bytes)</option><option value="Gbps">Gbps (bits)</option></select>')}
  <button class="tl-btn primary" id="dn-go" type="button">Calculate</button>
</div>
<div class="tl-res" id="dn-out">\u2014</div>`,
  script: `
var $=function(id){return document.getElementById(id);};
var SZ={KB:1e3,MB:1e6,GB:1e9,TB:1e12};
var SP={Mbps:1e6,MBps:8e6,Gbps:1e9};
function htime(t){if(t<1)return (t*1000).toFixed(0)+'\u202fms';
 var h=Math.floor(t/3600),m=Math.floor(t%3600/60),s=Math.round(t%60);
 var p=[];if(h)p.push(h+'\u202fh');if(h||m)p.push(m+'\u202fm');p.push(s+'\u202fs');return p.join(' ');}
function render(){var v=parseFloat($('dn-size').value),u=$('dn-sz').value,r=parseFloat($('dn-rate').value),ru=$('dn-rt').value;
 if(!(v>0)||!(r>0)){$('dn-out').innerHTML='<span class="tl-badge tl-no">check inputs</span> File size and speed both need to be positive numbers.';return;}
 var bytes=v*SZ[u],bits=bytes*8,sec=bits/(r*SP[ru]);
 $('dn-out').innerHTML='<div class="tl-big">'+htime(sec)+'</div>'+
 '<table class="tl-tab"><tbody>'+
 '<tr><td>Theoretical (full line rate)</td><td>'+htime(sec)+'</td></tr>'+
 '<tr><td>Realistic (85% of line rate)</td><td>'+htime(sec/0.85)+'</td></tr>'+
 '<tr><td>Slow connection (60%)</td><td>'+htime(sec/0.6)+'</td></tr>'+
 '<tr><td>File is</td><td>'+bytes.toLocaleString('en-US')+' bytes = '+(bytes/1024).toLocaleString('en-US',{maximumFractionDigits:1})+' KiB / '+(bytes/1048576).toLocaleString('en-US',{maximumFractionDigits:1})+' MiB / '+(bytes/1073741824).toLocaleString('en-US',{maximumFractionDigits:2})+' GiB</td></tr>'+
 '</tbody></table>'+
 '<p class="meta">Sizes use the decimal convention the shops use (1\u202fGB = 10\u2079 bytes); your OS divides by 1024 and will call the same file a few percent smaller. Upload into cloud storage runs the same maths in reverse \u2014 but many home lines are 1/10 the download rate.</p>';}
$('dn-go').onclick=render;$('dn-size').oninput=render;$('dn-rate').oninput=render;$('dn-sz').onchange=render;$('dn-rt').onchange=render;render();`,
  seo: `<h2 class="section-title">Why your \u201c100\u202fMbps\u201d plan gives you 85\u202fMbps</h2>
  <p>The advertised rate is the physical-layer payload budget; Ethernet framing, TCP handshakes, TLS record-keeping, and the router\u2019s own CPU each take a cut, and 80\u201390% is the honest landing zone on a good day. On Wi-Fi add distance, walls and neighbours\u2019 channels \u2014 which is why the 60% row exists. If a download runs exactly the theoretical time, you got a faster link than advertised, not a calculator that flattered you.</p>`,
});

// ── 25. /alat/comb — combinations & permutations ────────────────────────────
TOOLKIT.push({
  slug: 'comb', ic: '🧮', name: 'Combination Calculator',
  title: 'Combination & Permutation Calculator — nCr, nPr, Exact BigInt Factorials | Tukuk-OS',
  desc: 'How many ways can you choose: 5 cards from 52, 3 winners from 20 — combinations, permutations and full factorials computed as exact integers in your browser.',
  hero: 'Combination Calculator', sub: 'nCr · nPr · n! · exact BigInt · the order-vs-choice gap shown',
  navBlurb: 'C(52,5) = 2,598,960 poker hands as an exact integer — combinations, permutations and factorials with no float ever touching the maths.',
  hubBlurb: 'choose or arrange: exact nCr, nPr and n! with the multiplicative steps, and the C(n,r)=C(n,n−r) symmetry doing the work',
  lead: 'The gap between a <b>combination</b> (which items — order ignored) and a <b>permutation</b> (which items <i>and</i> which order) is the most-miscounted idea in everyday probability: 5 cards from 52 are 2,598,960 hands, but 2·431,840,640 ordered deals. Both live here with <b>BigInt</b> exactness — every product and division is an integer operation, so the answer is provably right, not floating-point approximate.',
  form: `<div class="tl-form">
  ${field('From (n items)', '<input id="cb-n" type="number" min="0" max="5000" step="1" value="52">')}
  ${field('Choose (r)', '<input id="cb-r" type="number" min="0" step="1" value="5">')}
  <button class="tl-btn primary" id="cb-go" type="button">Count</button>
</div>
<div class="tl-res" id="cb-out">—</div>`,
  script: `
var $=function(id){return document.getElementById(id);};
function fact(n){var r=1n;for(var i=2n;i<=n;i++)r*=i;return r;}
function falling(n,r){var out=1n;for(var i=0n;i<BigInt(r);i++)out*=BigInt(n)-i;return out;}
function choose(n,r){if(r>n)r=n-r;var out=1n;
 for(var i=0n;i<BigInt(r);i++)out=out*(BigInt(n)-i)/(i+1n);return out;}
function render(){var n=Number($('cb-n').value),r=Number($('cb-r').value);
 if(!Number.isInteger(n)||n<0||n>5000){$('cb-out').innerHTML='<span class="tl-badge tl-no">check input</span> n must be a whole number from 0 to 5,000 — larger still works, it just makes your tab wait.';return;}
 if(!Number.isInteger(r)||r<0){$('cb-out').innerHTML='<span class="tl-badge tl-no">check input</span> r must be a whole number of 0 or more.';return;}
 if(r>n){$('cb-out').innerHTML='<span class="tl-badge tl-no">impossible</span> You cannot choose '+r+' things from '+n+'. C and P are 0 here — a page that prints a number instead of that sentence is the buggy one.';return;}
 var c=choose(n,r),p=falling(n,r);
 var rows='<tr><td>Combinations C('+n+','+r+')</td><td>'+c.toLocaleString('en-US')+' — order does not matter</td></tr>'
 +'<tr><td>Permutations P('+n+','+r+')</td><td>'+p.toLocaleString('en-US')+' — every arrangement counts separately</td></tr>'
 +'<tr><td>The gap between them</td><td>'+c.toLocaleString('en-US')+' × '+fact(r).toLocaleString('en-US')+' ('+r+'! orderings) = '+p.toLocaleString('en-US')+'</td></tr>';
 if(n<=170)rows+='<tr><td>'+n+'!</td><td style="word-break:break-all;font-size:.8rem">'+fact(n).toLocaleString('en-US')+'</td></tr>';
 else rows+='<tr><td>'+n+'!</td><td class="meta">too many digits to print (it has '+Math.floor(n*Math.log10(n/Math.E)+Math.log10(2*Math.PI*n)/2+1)+' digits — Stirling counted it for us)</td></tr>';
 $('cb-out').innerHTML='<div class="tl-big">'+c.toLocaleString('en-US')+' <span class="meta" style="font-size:1rem">ways to choose</span></div><table class="tl-tab"><tbody>'+rows+'</tbody></table>'
 +(c>1000000n?'<p class="meta">As a chance: one random pick hits the exact group about once in '+c.toLocaleString('en-US')+' tries. That denominator is why lottery jackpots are annuities.</p>':'')
 +'<p class="meta">The loop uses the symmetry C(n,r)=C(n,n−r) — choosing 5 to keep is the same act as choosing 47 to leave — so it never runs more than n/2 steps, and each intermediate product is a smaller binomial, exactly divisible, which is why BigInt division never rounds here.</p>';}
$('cb-go').onclick=render;$('cb-n').oninput=render;$('cb-r').oninput=render;render();`,
  seo: `<h2 class="section-title">Why every second lottery ticket feels overdue</h2>
  <p>Independent draws have no memory — once in 13,983,816 (the classic 6-from-49 jackpot, C(49,6), shown exactly by this page) is a per-draw probability, not a schedule. The human pattern-matching brain that reads a long gap as a due win is the same one that reads permutations as combinations and miscounts the real odds by a factor of 720 (that is 6!). Getting the integer right is the whole defence: 2,598,960 hands you can check; "about 2.6 million" is where the mistakes hide.</p>`,
});

// ── 26. /alat/gcd — GCD & LCM with the Euclid steps ─────────────────────────
TOOLKIT.push({
  slug: 'gcd', ic: '➗', name: 'GCD & LCM Calculator',
  title: 'GCD & LCM Calculator — Euclidean Algorithm Steps Shown | Tukuk-OS',
  desc: 'Greatest common divisor and least common multiple of two numbers, with every Euclidean division step printed, coprime detection and the reduced fraction.',
  hero: 'GCD & LCM', sub: 'Euclid\'s steps printed · coprime check · lcm = a×b ÷ gcd',
  navBlurb: 'gcd(1071,462) = 21 with each Euclidean division printed as it happens — plus the LCM, the coprime verdict and the reduced fraction.',
  hubBlurb: 'the paper-and-pencil maths shown line by line: Euclid\'s divisions, the lcm built from the gcd, and fraction-reducing as a bonus',
  lead: 'The <b>Euclidean algorithm</b> is 2,300 years old and still the fastest way to the greatest common divisor: keep dividing, keep the remainder, stop at zero — the last divisor is the gcd. This page prints each division as it runs so you can see <i>why</i> the answer is what it is, then builds the least common multiple from it: lcm(a,b) = a×b ÷ gcd(a,b).',
  form: `<div class="tl-form">
  ${field('First number', '<input id="gd-a" type="number" min="0" step="1" value="1071">')}
  ${field('Second number', '<input id="gd-b" type="number" min="0" step="1" value="462">')}
  <button class="tl-btn primary" id="gd-go" type="button">Compute</button>
</div>
<div class="tl-res" id="gd-out">—</div>`,
  script: `
var $=function(id){return document.getElementById(id);};
function render(){var A=Number($('gd-a').value),B=Number($('gd-b').value);
 if(!Number.isInteger(A)||!Number.isInteger(B)||A<0||B<0||A>9e14||B>9e14){$('gd-out').innerHTML='<span class="tl-badge tl-no">check input</span> Two whole numbers from 0 to 900 trillion (past that the lcm product can leave exact double territory).';return;}
 if(A===0&&B===0){$('gd-out').innerHTML='<span class="tl-badge tl-no">undefined</span> gcd(0,0) has no answer every textbook agrees on — every number divides 0, so there is no greatest one. The convention some languages pick (0) is a convenience, not maths.';return;}
 var a=A,b=B,steps=[];
 while(b!==0){var q=Math.floor(a/b),r=a%b;steps.push(a.toLocaleString('en-US')+' = '+q.toLocaleString('en-US')+' × '+b.toLocaleString('en-US')+' + '+r.toLocaleString('en-US'));a=b;b=r;}
 var g=a;
 var lcm=A===0||B===0?0:(A/g)*B;
 var html='<div class="tl-big">gcd = '+g.toLocaleString('en-US')+' <span class="meta" style="font-size:1rem">· lcm = '+lcm.toLocaleString('en-US')+'</span></div>';
 html+='<table class="tl-tab"><tbody>';steps.forEach(function(s,i){html+='<tr><td>step '+(i+1)+'</td><td>'+s+'</td></tr>';});
 html+='<tr><td>stop</td><td>remainder reached 0 — the divisor of that step ('+g.toLocaleString('en-US')+') is the gcd</td></tr></tbody></table>';
 html+='<p class="meta">lcm('+A+','+B+') = '+A.toLocaleString('en-US')+' × '+B.toLocaleString('en-US')+' ÷ '+g+' = '+lcm.toLocaleString('en-US')+'.</p>';
 if(g===1)html+='<p class="meta"><span class="tl-badge tl-ok">coprime</span> Nothing but 1 divides both, so the fraction '+A+'/'+B+' is already fully reduced.</p>';
 else html+='<p class="meta">Fraction bonus: '+A+'/'+B+' reduces by '+g+' to '+(A/g)+'/'+(B/g)+(B/g===1?' (a whole number, actually '+(A/g)+')':'')+'.</p>';
 $('gd-out').innerHTML=html;}
$('gd-go').onclick=render;$('gd-a').oninput=render;$('gd-b').oninput=render;render();`,
  seo: `<h2 class="section-title">Why Euclid beats brute force</h2>
  <p>Factoring both numbers to find shared primes is exponential work for anything the size of a cryptographic integer; Euclid needs only about five times the digit count in divisions — computing gcd of two 64-bit numbers is microseconds of arithmetic. That speed is why the algorithm sits inside every rational-arithmetic library, every calendar cycle calculation and, since the 1970s, the RSA key generator: the extended version of these same subtraction steps also finds the modular inverse that makes RSA keys possible.</p>`,
});

// ── 27. /alat/triangle — triangle solver ─────────────────────────────────────
TOOLKIT.push({
  slug: 'triangle', ic: '🔺', name: 'Triangle Solver',
  title: 'Triangle Solver — SSS & SAS with Law of Cosines, Heron Area, Steps Shown | Tukuk-OS',
  desc: 'Solve any triangle from three sides or two sides and the included angle: all angles by the law of cosines, area by Heron, right/obtuse/acute verdict.',
  hero: 'Triangle Solver', sub: 'SSS · SAS · law of cosines · Heron area · inequality checked',
  navBlurb: 'Three sides in, three angles, area and perimeter out — with the triangle inequality and the right/obtuse verdict stated honestly.',
  hubBlurb: '3-4-5 tells you it is right: every angle from the law of cosines, area from Heron, and a refusal to solve sides that cannot close',
  lead: 'A triangle is fully determined by <b>three sides</b> (SSS) or <b>two sides and the angle between them</b> (SAS) — this solver takes either, uses the <b>law of cosines</b> for the angles (never the law of sines, whose ambiguous case silently produces two answers), and <b>Heron\'s formula</b> for the area. If the sides cannot close into a triangle, the page says so and shows which inequality failed.',
  form: `<div class="tl-form">
  ${field('Known', '<select id="tr-mode"><option value="sss" selected>three sides (SSS)</option><option value="sas">two sides + included angle (SAS)</option></select>')}
  ${field('Side a', '<input id="tr-a" type="number" min="0.001" step="any" value="3">')}
  ${field('Side b', '<input id="tr-b" type="number" min="0.001" step="any" value="4">')}
  ${field('Side c', '<input id="tr-c" type="number" min="0.001" step="any" value="5">')}
  ${field('Included angle C (°)', '<input id="tr-ang" type="number" min="0.1" max="179.9" step="any" value="90">')}
  <button class="tl-btn primary" id="tr-go" type="button">Solve</button>
</div>
<div class="tl-res" id="tr-out">—</div>`,
  script: `
var $=function(id){return document.getElementById(id);};
var RAD=Math.PI/180;
function deg(r){return r/RAD;}
function sideLabel(v){return Number(v.toFixed(3)).toString();}
function solve(a,b,c,note){
 if(a+b<=c||a+c<=b||b+c<=a){var f=a+b<=c?'a + b ≤ c':(a+c<=b?'a + c ≤ b':'b + c ≤ a');
  return '<span class="tl-badge tl-no">cannot close</span> '+f+' ('+sideLabel(a)+' + '+sideLabel(b)+' vs '+sideLabel(c)+' etc.) — the triangle inequality fails, so no triangle has these sides. Two sticks shorter than the third never meet.';}
 var A=deg(Math.acos(Math.min(1,Math.max(-1,(b*b+c*c-a*a)/(2*b*c)))));
 var B=deg(Math.acos(Math.min(1,Math.max(-1,(a*a+c*c-b*b)/(2*a*c)))));
 var C=180-A-B;
 var s=(a+b+c)/2,area=Math.sqrt(s*(s-a)*(s-b)*(s-c));
 var kind=A>=90||B>=90||C>=90?(Math.abs(A-90)<1e-9||Math.abs(B-90)<1e-9||Math.abs(C-90)<1e-9?'right':'obtuse'):'acute';
 var iso=(Math.abs(a-b)<1e-9&&Math.abs(b-c)<1e-9)?'equilateral':(Math.abs(a-b)<1e-9||Math.abs(b-c)<1e-9||Math.abs(a-c)<1e-9?'isosceles':'scalene');
 var html='<div class="tl-big">'+area.toFixed(3)+' <span class="meta" style="font-size:1rem">square units · '+kind+' '+iso+'</span></div>';
 html+='<table class="tl-tab"><tbody>';
 html+='<tr><td>Angle A (opposite a='+sideLabel(a)+')</td><td>'+A.toFixed(2)+'°</td></tr>';
 html+='<tr><td>Angle B (opposite b='+sideLabel(b)+')</td><td>'+B.toFixed(2)+'°</td></tr>';
 html+='<tr><td>Angle C (opposite c='+sideLabel(c)+')</td><td>'+C.toFixed(2)+'°</td></tr>';
 html+='<tr><td>Perimeter</td><td>'+sideLabel(a+b+c)+'</td></tr>';
 if(note)html+='<tr><td>Method</td><td>'+note+'</td></tr>';
 html+='</tbody></table>';
 html+='<p class="meta">Angles come from the law of cosines (cos C = (a²+b²−c²)/2ab) — one unambiguous answer per angle. Area is Heron\\'s: √(s(s−a)(s−b)(s−c)) with s = half the perimeter; for a right triangle it matches ½×legs exactly.</p>';
 return html;}
function render(){var mode=$('tr-mode').value;
 var a=parseFloat($('tr-a').value),b=parseFloat($('tr-b').value);
 if(!(a>0)||!(b>0)){$('tr-out').innerHTML='<span class="tl-badge tl-no">check input</span> Sides a and b must be positive numbers.';return;}
 if(mode==='sss'){var c=parseFloat($('tr-c').value);
  if(!(c>0)){$('tr-out').innerHTML='<span class="tl-badge tl-no">check input</span> SSS needs all three sides.';return;}
  $('tr-out').innerHTML=solve(a,b,c,'SSS — Heron + law of cosines');return;}
 var C=parseFloat($('tr-ang').value);
 if(!(C>0&&C<180)){$('tr-out').innerHTML='<span class="tl-badge tl-no">check input</span> The included angle must be between 0° and 180° (exclusive — 0° and 180° are flat lines, not triangles).';return;}
 var c=Math.sqrt(a*a+b*b-2*a*b*Math.cos(C*RAD));
 $('tr-out').innerHTML=solve(a,b,c,'SAS — side c from the law of cosines: c² = a² + b² − 2ab·cos C = '+sideLabel(a*a+b*b-2*a*b*Math.cos(C*RAD))+', c = '+sideLabel(c))+
  '<p class="meta">SAS has no ambiguous case: two sides and the angle <i>between</i> them pin the third side uniquely. That is why this page refuses SSA input instead of guessing which of two triangles you meant.</p>';}
$('tr-go').onclick=render;['tr-a','tr-b','tr-c','tr-ang'].forEach(function(i){$(i).oninput=render;});$('tr-mode').onchange=render;render();`,
  seo: `<h2 class="section-title">The ambiguous case the law of sines walks into</h2>
  <p>Given two sides and a non-included angle, sin⁻¹ returns two angles (θ and 180−θ) and both can be geometrically legal — the SSA "ambiguous case" that school trigonometry quietly warns about. The law of cosines avoids the trap entirely because acos returns exactly one value in 0–180°, which is why every angle on this page is computed with it. Heron\'s formula closes the loop: area from sides alone, no height measurement needed — surveyors have used the pair of tricks to triangulate fields since before calculators existed.</p>`,
});

// ── 28. /alat/readability — Flesch scores & reading time ────────────────
TOOLKIT.push({
  slug: 'readability', ic: '📖', name: 'Readability Checker',
  title: 'Readability Checker — Flesch Reading Ease, Grade Level & Reading Time | Tukuk-OS',
  desc: 'Paste any English text and get the Flesch Reading Ease score, Flesch–Kincaid grade level, sentence and syllable counts, and how long it takes to read. Runs in your browser.',
  hero: 'Readability Checker', sub: 'Flesch Reading Ease · Kincaid grade · words/sentences/syllables · reading time',
  navBlurb: 'Flesch Reading Ease and Kincaid grade for any English text, with the syllable maths and a 230-wpm reading time — computed on your device.',
  hubBlurb: 'is your writing news-simple or journal-dense? the 1948 Flesch score plus grade level, counted word by word without uploading anything',
  lead: 'Rudolf Flesch\'s 1948 insight was that readability is arithmetic: sentences and words predict how hard a text reads — <b>206.835 − 1.015×(words per sentence) − 84.6×(syllables per word)</b>. Above 90 reads like a children\'s book, 60–70 like the news you are writing, below 30 like a journal. This page counts your words, sentences and syllables (heuristic vowel-group counter, same one the classics use) and runs the two published formulas out loud.',
  form: `<textarea class="tl-in" id="rb-in" spellcheck="false" rows="7">The cat sat on the mat.</textarea>
<div class="tl-form">
  <button class="tl-btn primary" id="rb-go" type="button">Score it</button>
</div>
<div class="tl-res" id="rb-out">—</div>`,
  script: `
var $=function(id){return document.getElementById(id);};
function syllables(w){w=w.toLowerCase().replace(/[^a-z]/g,'');if(!w)return 0;
 var m=w.match(/[aeiouy]+/g);var n=m?m.length:1;
 if(n>1&&/e$/.test(w))n--;return n;}
function render(){var text=$('rb-in').value;
 var words=text.match(/[A-Za-z0-9]+(?:['-][A-Za-z0-9]+)*/g)||[];
 if(!words.length){$('rb-out').innerHTML='<span class="tl-badge tl-no">nothing to score</span> Type or paste at least one word — the maths counts syllables, words and sentences, and you have handed it none.';return;}
 var nSent=(text.match(/[.!?]+/g)||[]).length||1;
 var syl=0;for(var i=0;i<words.length;i++)syl+=syllables(words[i]);
 var asl=words.length/nSent,asw=syl/words.length;
 var fre=206.835-1.015*asl-84.6*asw;
 var fk=0.39*asl+11.8*asw-15.59;
 var band=fre>=90?['tl-ok','very easy — children\\'s books, signage, the goal for consumer copy']
  :fre>=60?['tl-ok','plain English — news and blogs live here; aim no higher']
  :fre>=50?['tl-no','fairly hard — official prose and dense journalism']
  :fre>=30?['tl-no','difficult — academic writing, read twice by most people']
  :['tl-no','very difficult — specialist text; the general audience is not coming'];
 var secs=Math.max(1,Math.round(words.length/230*60));
 $('rb-out').innerHTML='<div class="tl-big">'+fre.toFixed(1)+' <span class="meta" style="font-size:1rem">Flesch Reading Ease</span></div>'
 +'<p><span class="tl-badge '+band[0]+'">'+band[1]+'</span></p>'
 +'<table class="tl-tab"><tbody>'
 +'<tr><td>Words</td><td>'+words.length.toLocaleString('en-US')+'</td></tr>'
 +'<tr><td>Sentences (runs of . ! ? count once)</td><td>'+nSent+'</td></tr>'
 +'<tr><td>Syllables (vowel-group heuristic)</td><td>'+syl+' · '+asw.toFixed(2)+' per word</td></tr>'
 +'<tr><td>Average sentence length</td><td>'+asl.toFixed(1)+' words</td></tr>'
 +'<tr><td>Flesch–Kincaid grade</td><td>'+fk.toFixed(1)+' — US school year equivalent (12 = high-school graduate)</td></tr>'
 +'<tr><td>Reading time</td><td>'+(secs<60?secs+' s':Math.round(secs/60)+' min')+' at 230 wpm silent reading (about 180 wpm spoken)</td></tr>'
 +'</tbody></table>'
 +'<p class="meta">The scale tops out near 121, not 100 — a short-sentence text of one-syllable words scores in the 110s, which is why a nursery rhyme reads 116 and still makes sense.</p>';}
$('rb-go').onclick=render;$('rb-in').oninput=render;render();`,
  seo: `<h2 class="section-title">What the score can and cannot tell you</h2>
  <p>Flesch measures rhythm — sentence length and word length — nothing about whether the text is true, clear or kind to the reader. A list of short simple nonsense scores 100+; a perfectly clear technical definition with three long words can read \"difficult\". Use it as a smoke alarm for runaway sentences, not as a writing trophy: the counter on this page also counts hyphenated compounds and possessives as one word and treats silent trailing -e as unheard, the same conventions the original 1948 implementation documented.</p>`,
});

// ── 29. /alat/tdee — Mifflin-St Jeor calories ────────────────────────────────
TOOLKIT.push({
  slug: 'tdee', ic: '🔥', name: 'Calorie & TDEE Calculator',
  title: 'Calorie Needs Calculator — Mifflin-St Jeor BMR & TDEE | Tukuk-OS',
  desc: 'Daily calorie needs from the Mifflin-St Jeor equation — the most accurate standard formula — with BMR, activity-multiplied TDEE and honest +/- deficit rows. Browser-local.',
  hero: 'Calorie & TDEE Calculator', sub: 'Mifflin-St Jeor 1990 · BMR × activity factor · ±250/500 rows',
  navBlurb: 'BMR and daily calorie needs via Mifflin-St Jeor — the formula dietitians actually validate against — with weight-change rows instead of promises.',
  hubBlurb: 'what you burn at rest, what you burn per day, and exactly which 250/500 kcal row moves the scale — Mifflin maths, stated with its error bars',
  lead: 'The <b>Mifflin-St Jeor equation (1990)</b> is the formula the Academy of Nutrition and Dietetics calls the most accurate of the standard ones for healthy adults — men: 10×kg + 6.25×cm − 5×age + 5; women: the same, minus 161. That is your <b>BMR</b>, the calories a comatose body burns. Multiply by an activity factor to get <b>TDEE</b>, the maintenance number — and know the honest error bar: ±9%, because body composition, genetics and NEAT move it.',
  form: `<div class="tl-form">
  ${field('Sex', '<select id="td-sex"><option value="m" selected>male</option><option value="f">female</option></select>')}
  ${field('Age', '<input id="td-age" type="number" min="10" max="100" step="1" value="30">')}
  ${field('Height (cm)', '<input id="td-h" type="number" min="100" max="250" step="1" value="175">')}
  ${field('Weight (kg)', '<input id="td-w" type="number" min="21" step="0.5" value="70">')}
  ${field('Activity', '<select id="td-act"><option value="1.2" selected>sedentary — desk work, little exercise</option><option value="1.375">light — 1–3 sessions/week</option><option value="1.55">moderate — 3–5 sessions/week</option><option value="1.725">very — 6–7 sessions/week</option><option value="1.9">athlete — 2×/day or physical job</option></select>')}
  <button class="tl-btn primary" id="td-go" type="button">Calculate</button>
</div>
<div class="tl-res" id="td-out">—</div>`,
  script: `
var $=function(id){return document.getElementById(id);};
var ACTS={'1.2':'sedentary','1.375':'light activity','1.55':'moderate activity','1.725':'very active','1.9':'athlete'};
function fmt(n){return Math.round(n).toLocaleString('en-US');}
function render(){var male=$('td-sex').value==='m',age=Number($('td-age').value),h=Number($('td-h').value),w=Number($('td-w').value),act=parseFloat($('td-act').value);
 if(!(age>=10&&age<=100)||!(h>=100&&h<=250)||!(w>=21&&w<=400)){$('td-out').innerHTML='<span class="tl-badge tl-no">check inputs</span> Age 10–100, height 100–250 cm, weight 21–400 kg — the equation is adult-sized science; outside its range it is extrapolation.';return;}
 var bmr=10*w+6.25*h-5*age+(male?5:-161);
 var tdee=bmr*act;
 var actName=ACTS[String(act)]||'custom factor';
 $('td-out').innerHTML='<div class="tl-big">'+fmt(tdee)+' <span class="meta" style="font-size:1rem">kcal/day maintenance</span></div>'
 +'<table class="tl-tab"><tbody>'
 +'<tr><td>BMR (at complete rest)</td><td>'+fmt(bmr)+' kcal</td></tr>'
 +'<tr><td>Activity multiplier</td><td>× '+act+' — '+actName+'</td></tr>'
 +'<tr><td>Eat '+fmt(tdee-500)+'</td><td>≈ −0.45 kg/week (the classic 500 kcal deficit)</td></tr>'
 +'<tr><td>Eat '+fmt(tdee-250)+'</td><td>≈ −0.25 kg/week — slow, sustainable, fewer hunger fights</td></tr>'
 +'<tr><td>Eat '+fmt(tdee+250)+'</td><td>≈ +0.25 kg/week — the lean-bulk pace</td></tr>'
 +'<tr><td>Eat '+fmt(tdee+500)+'</td><td>≈ +0.45 kg/week — beyond this the surplus outgrows training\\'s share</td></tr>'
 +'</tbody></table>'
 +'<p class="meta">The ±0.5 kg/week rows use the 3,500 kcal ≈ 0.45 kg body-mass convention; in practice adaptation makes losses slower than the arithmetic after month one — the rows are a pace, not a promise. Accuracy of Mifflin itself: about ±9% against measured expenditure (a 2,000 kcal answer can really be 1,820–2,180). Use the number as a starting weight on the scale of weeks of real data, not a prescription; if you have a medical condition this page is not your dietitian.</p>';}
$('td-go').onclick=render;['td-age','td-h','td-w'].forEach(function(i){$(i).oninput=render;});$('td-sex').onchange=render;$('td-act').onchange=render;render();`,
  seo: `<h2 class="section-title">Why the Harris-Benedict pages are showing their age</h2>
  <p>The older Harris-Benedict equation (1919, revised 1984) was measured on a leaner, shorter population and runs roughly 5% high for modern bodies — enough to quietly stall a fat-loss plan that trusted it. Mifflin-St Jeor\'s 1990 cohort (22,500 measured people) is closer to today\'s populations, which is why every current dietetic reference defaults to it. Both are population estimates: the only equation that fits you exactly is your own scale after three honest weeks.</p>`,
});

// ── 30. /alat/inflate — compound inflation maths ──────────────────────────
TOOLKIT.push({
  slug: 'inflate', ic: '💹', name: 'Inflation Calculator',
  title: 'Inflation Calculator — Future Prices & Real Value, With the Rule of 72 | Tukuk-OS',
  desc: 'What will this cost in N years at R% a year — and what is today\'s money really worth later? Compound inflation maths, doubling time exact and rule-of-72, browser-local.',
  hero: 'Inflation Calculator', sub: 'FV = PV × (1+r)ᵗ · exact doubling years · rule of 72 compared',
  navBlurb: 'Prices forward and values backward by compound maths — with the exact doubling year count next to the rule-of-72 shortcut.',
  hubBlurb: '3% for 10 years turns 1,000 into 1,343.92 — the compounding printed year by year, plus how fast your money halves itself',
  lead: 'Inflation is compound interest running the wrong way. This page does the two directions of that arithmetic: <b>forward</b> — what today\'s figure costs in N years at your stated rate — and <b>backward</b> — what today\'s pile of cash is really worth in N years. It prints the exact doubling/halving time alongside the <b>rule of 72</b> shortcut, because every finance page quotes the shortcut without checking it.',
  form: `<div class="tl-form">
  ${field('Amount', '<input id="xf-amt" type="number" min="0.01" step="any" value="1000">')}
  ${field('Annual inflation rate (%)', '<input id="xf-rate" type="number" min="-5" max="30" step="any" value="3">')}
  ${field('Years', '<input id="xf-yrs" type="number" min="0" max="150" step="1" value="10">')}
  ${field('Direction', '<select id="xf-mode"><option value="future" selected>price forward: what will it cost?</option><option value="real">value backward: what is this really worth later?</option></select>')}
  <button class="tl-btn primary" id="xf-go" type="button">Compound it</button>
</div>
<div class="tl-res" id="xf-out">—</div>`,
  script: `
var $=function(id){return document.getElementById(id);};
function money(v){return v.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});}
function render(){var amt=parseFloat($('xf-amt').value),r=parseFloat($('xf-rate').value),y=Number($('xf-yrs').value),mode=$('xf-mode').value;
 if(!(amt>0)){$('xf-out').innerHTML='<span class="tl-badge tl-no">check input</span> The amount must be a positive number.';return;}
 if(!(r>=-5&&r<=30)){$('xf-out').innerHTML='<span class="tl-badge tl-no">check input</span> Rate between −5% and 30% — outside that, \"inflation\" stops being the word that describes it.';return;}
 if(!Number.isInteger(y)||y<0||y>150){$('xf-out').innerHTML='<span class="tl-badge tl-no">check input</span> Years: a whole number from 0 to 150.';return;}
 var f=Math.pow(1+r/100,y);
 var out=mode==='future'?amt*f:amt/f;
 var html='<div class="tl-big">'+money(out)+'</div>';
 html+='<p class="meta">'+(mode==='future'
  ?'At '+r+'% a year, '+money(amt)+' costs <b>'+money(out)+'</b> in '+y+' year'+(y===1?'':'s')+' — '+money(out-amt)+' more ('+((f-1)*100).toFixed(1)+'%).'
  :'At '+r+'% a year, '+money(amt)+' today keeps the buying power of <b>'+money(out)+'</b> in '+y+' year'+(y===1?'':'s')+' — '+(100-100/f).toFixed(1)+'% of it evaporates.')+'</p>';
 html+='<table class="tl-tab"><tbody>'
 +'<tr><td>Compound factor</td><td>× '+f.toFixed(4)+'</td></tr>';
 if(r>0){var dbl=Math.log(2)/Math.log(1+r/100);
  html+='<tr><td>Prices double in</td><td>'+dbl.toFixed(1)+' years — rule of 72 says '+(72/r).toFixed(1)+'</td></tr>';}
 if(r<0){html+='<tr><td>Deflation</td><td>prices fall; '+Math.abs(r)+'% a year means goods cost less, wages usually do too — which is the part history keeps getting wrong.</td></tr>';}
 if(r===0)html+='<tr><td>Zero rate</td><td>nothing compounds; the arithmetic politely collapses to the same number.</td></tr>';
 html+='<tr><td>Half of it gone in</td><td>'+(r>0?(Math.log(0.5)/Math.log(1+r/100)).toFixed(1)+' years':'n/a')+'</td></tr>';
 html+='</tbody></table>';
 var step=y<=30?1:(y<=60?5:10);
 html+='<p class="meta">Year by year (every '+(step===1?'year':step+' years')+' for the printed run):</p><table class="tl-tab"><tbody>';
 for(var i=0;i<=y;i+=step){html+='<tr><td>year '+i+'</td><td>'+(mode==='future'?money(amt*Math.pow(1+r/100,i)):money(amt/Math.pow(1+r/100,i)))+'</td></tr>';}
 html+='</tbody></table>';
 $('xf-out').innerHTML=html;}
$('xf-go').onclick=render;['xf-amt','xf-rate','xf-yrs'].forEach(function(i){$(i).oninput=render;});$('xf-mode').onchange=render;render();`,
  seo: `<h2 class="section-title">Bring your own honest rate</h2>
  <p>This page deliberately does not fetch \"the\" inflation rate: every country publishes several (headline CPI, core CPI, your personal basket), revisions land months later, and a silent API number on a calculator page hides which one you are compounding. Look up your own statistics office\'s current CPI — the one with the publication date on it — and type that here. The rule of 72 is printed next to the exact logarithm on purpose: at 2% it says 36 years while the truth is 35.0 — a 3% error that is fine for coffee talk and not fine for a retirement plan.</p>`,
});

// ── 31. /alat/cipher — classical ciphers, taught honestly ────────────────
TOOLKIT.push({
  slug: 'cipher', ic: '🗝️', name: 'Caesar & Vigenère Cipher',
  title: 'Caesar & Vigenère Cipher Encoder — ROT13, Atbash Too | Tukuk-OS',
  desc: 'Encode and decode Caesar (including ROT13), Atbash and Vigenère text with the maths shown — case preserved, non-letters untouched. Educational ciphers, explicitly not security.',
  hero: 'Caesar & Vigenère Cipher', sub: 'Caesar · ROT13 · Atbash · Vigenère · encode/decode · case kept',
  navBlurb: 'The ciphers history actually used — Caesar, ROT13, Atbash, Vigenère — encoded and decoded with the shift maths printed and no false security claims.',
  hubBlurb: 'rotate, mirror or polybius-square the alphabet: four classic ciphers both directions, with the honest note that none of them survive a afternoon of cryptanalysis',
  lead: 'Four ciphers that carry real history: <b>Caesar</b> (shift every letter by k — ROT13 is just k=13, its own inverse), <b>Atbash</b> (flip the alphabet, Hebrew-letterbook wisdom), and <b>Vigenère</b> (a different Caesar shift per letter from a keyword — the \"le boundless\" cipher that resisted casual breaking for three centuries). Everything runs on your device and the page says the quiet part out loud: these are <b>not encryption</b>. A cipher you can demo on a napkin is a cipher a computer breaks before the soup arrives.',
  form: `<textarea class="tl-in" id="cp-text" spellcheck="false" rows="4">Attack at dawn</textarea>
<div class="tl-form">
  ${field('Cipher', '<select id="cp-kind"><option value="caesar" selected>Caesar (shift by key)</option><option value="rot13">ROT13 (the self-inverse one)</option><option value="atbash">Atbash (alphabet mirror)</option><option value="vigenere">Vigenère (keyword)</option></select>')}
  ${field('Key (shift or word)', '<input id="cp-key" type="text" value="3" autocomplete="off" spellcheck="false">')}
  ${field('Direction', '<select id="cp-dir"><option value="enc" selected>encrypt</option><option value="dec">decrypt</option></select>')}
  <button class="tl-btn primary" id="cp-go" type="button">Run</button>
</div>
<div class="tl-res" id="cp-out">—</div>`,
  script: `
var $=function(id){return document.getElementById(id);};
function esc(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function isLet(c){return (c>='a'&&c<='z')||(c>='A'&&c<='Z');}
function shiftChar(c,k){var upper=c>='A'&&c<='Z';var base=upper?65:97;
 var v=((c.charCodeAt(0)-base+k)%26+26)%26;
 return String.fromCharCode(base+v);}
function atbashChar(c){var upper=c>='A'&&c<='Z';var base=upper?65:97;
 return String.fromCharCode(base+25-(c.charCodeAt(0)-base));}
function render(){var kind=$('cp-kind').value,dir=$('cp-dir').value,text=$('cp-text').value,key=$('cp-key').value.trim();
 var rot=dir==='dec';
 if(kind==='caesar'||kind==='vigenere'){
  if(!key){$('cp-out').innerHTML='<span class="tl-badge tl-no">needs a key</span> Caesar wants a number, Vigenère a keyword — the field is empty.';return;}}
 if(kind==='caesar'||kind==='rot13'){
  var k=kind==='rot13'?13:(parseInt(key,10));
  if(kind==='caesar'&&isNaN(k)){$('cp-out').innerHTML='<span class="tl-badge tl-no">check key</span> The Caesar key must be a whole number of positions (0–25 or beyond, it wraps).';return;}
  if(rot)k=26-k;
  var out='',letters=0;
  for(var i=0;i<text.length;i++){var c=text[i];if(isLet(c)){letters++;out+=shiftChar(c,k);}else out+=c;}
  $('cp-out').innerHTML='<div class="tl-pick" style="word-break:break-word">'+esc(out)+'</div>'
   +'<p class="meta">'+(kind==='rot13'?'ROT13 shift 13':'Caesar shift '+((dir==='dec'?26-parseInt(key,10)%26:parseInt(key,10)%26+26)%26)+' mod 26')+' · '+letters+' of '+text.length+' characters were letters; spaces, digits and punctuation passed through untouched, as every classical cipher does.</p>';
  return;}
 if(kind==='atbash'){
  var o2='',l2=0;
  for(var j=0;j<text.length;j++){var c2=text[j];if(isLet(c2)){l2++;o2+=atbashChar(c2);}else o2+=c2;}
  $('cp-out').innerHTML='<div class="tl-pick" style="word-break:break-word">'+esc(o2)+'</div><p class="meta">Atbash maps A↔Z, B↔Y, C↔X… it is its own inverse, so encrypt and decrypt are the same machine — which is also its cryptanalytic epitaph. '+l2+' letters mirrored.</p>';
  return;}
 // vigenere
 if(!/^[A-Za-z]+$/.test(key)){$('cp-out').innerHTML='<span class="tl-badge tl-no">check key</span> A Vigenère keyword must be letters only (the historical versions never mixed digits into the square).';return;}
 var ks=key.toUpperCase(),out3='',li=0,used=0;
 for(var m=0;m<text.length;m++){var c3=text[m];
  if(!isLet(c3)){out3+=c3;continue;}
  var s=ks.charCodeAt(li%ks.length)-65;if(rot)s=26-s;
  out3+=shiftChar(c3,s);li++;used++;}
 var repeats=Math.ceil(used/ks.length);
 $('cp-out').innerHTML='<div class="tl-pick" style="word-break:break-word">'+esc(out3)+'</div>'
  +'<p class="meta">Keyword \"'+esc(ks)+'\" ('+ks.length+' letters) cycled '+repeats+' times under the text: each letter is a Caesar shift by its keyword letter. That the cycle repeats is exactly what gave Kasiski and Babbage the seam to unpick it — the length of the key is the first thing an attacker guesses.</p>';}
$('cp-go').onclick=render;$('cp-text').oninput=render;$('cp-key').oninput=render;$('cp-kind').onchange=render;$('cp-dir').onchange=render;render();`,
  seo: `<h2 class="section-title">Why \"encrypted with a Caesar cipher\" is a joke in security circles</h2>
  <p>Twenty-five possible keys for Caesar is fewer than a four-digit PIN tries before lunch; a simple frequency count breaks it in seconds because English E still arrives first no matter how far you marched the alphabet. Vigenère survived until the 1850s precisely because its repeating key finally hid frequency — until Kasiski found the repeat distance. The lesson each of these teaches is Kerckhoffs\'s principle: the algorithm is never the secret, only the key is, and 25 or 26ⁿ key-space is not a defence. Use them to understand history and to amuse your friends; use real AES-GCM libraries for anything you would not post on a door.</p>`,
});

// ── 32. /alat/paint — paint & plaster coverage ──────────────────────────
TOOLKIT.push({
  slug: 'paint', ic: '🖌️', name: 'Paint Coverage Calculator',
  title: 'Paint Coverage Calculator — Wall Area, Litres and Cans to Buy | Tukuk-OS',
  desc: 'Room wall area minus doors and windows, litres needed at your paint\'s real spread rate, 10% waste and the two-coat reality — no marketing rounding.',
  hero: 'Paint Coverage Calculator', sub: 'wall area · openings deducted · 10% waste · two-coat warning',
  navBlurb: 'How much paint the room actually needs: wall area minus doors and windows, at the tin\'s real m²-per-litre, with waste and second coats included.',
  hubBlurb: 'buy the right number of tins: gross wall area, openings deducted, spread rate honoured, and the second coat nobody prices in',
  lead: 'Paint tins quote coverage (a common figure is ~10 m² per litre on smooth walls — yours is printed on yours) and rooms quote traps: doors, windows and the second coat over a dark or raw surface. This page does the subtraction chain honestly: gross wall area → minus openings → litres at your spread rate → plus 10% for roller leftovers and touch-ups → plus double when the colour change demands two coats.',
  form: `<div class="tl-form">
  ${field('Room length (m)', '<input id="pt-l" type="number" min="0.5" step="any" value="5">')}
  ${field('Room width (m)', '<input id="pt-w" type="number" min="0.5" step="any" value="4">')}
  ${field('Wall height (m)', '<input id="pt-h" type="number" min="0.5" step="any" value="2.4">')}
  ${field('Doors + windows (m²)', '<input id="pt-open" type="number" min="0" step="any" value="6">')}
  ${field('Spread rate (m² per litre)', '<input id="pt-cov" type="number" min="1" step="any" value="10">')}
  ${field('Price per litre (optional)', '<input id="pt-cost" type="number" min="0" step="any" value="0">')}
  <button class="tl-btn primary" id="pt-go" type="button">Calculate</button>
</div>
<div class="tl-res" id="pt-out">—</div>`,
  script: `
var $=function(id){return document.getElementById(id);};
function num2(v){return (Math.round(v*100)/100).toLocaleString('en-US',{maximumFractionDigits:2});}
function render(){var l=parseFloat($('pt-l').value),w=parseFloat($('pt-w').value),h=parseFloat($('pt-h').value);
 var open=parseFloat($('pt-open').value)||0,cov=parseFloat($('pt-cov').value),price=parseFloat($('pt-cost').value)||0;
 if(!(l>0)||!(w>0)||!(h>0)||!(cov>0)){$('pt-out').innerHTML='<span class="tl-badge tl-no">check inputs</span> Length, width, height and spread rate must all be positive numbers.';return;}
 if(open<0||open>=2*(l+w)*h){$('pt-out').innerHTML='<span class="tl-badge tl-no">check input</span> The openings are larger than the whole room — that is a greenhouse, not a wall estimate.';return;}
 var gross=2*(l+w)*h,net=gross-open;
 var litres=net/cov,buy=Math.ceil(litres*1.1*10)/10;
 var html='<div class="tl-big">'+buy+' L <span class="meta" style="font-size:1rem">to buy (one coat + 10% waste)</span></div>';
 html+='<table class="tl-tab"><tbody>'
 +'<tr><td>Gross wall area</td><td>2×('+l+'+'+w+')m × '+h+'m = '+num2(gross)+' m²</td></tr>'
 +'<tr><td>Minus doors &amp; windows</td><td>− '+num2(open)+' m² → '+num2(net)+' m² to paint</td></tr>'
 +'<tr><td>At '+cov+' m² per litre</td><td>'+num2(litres)+' L</td></tr>'
 +'<tr><td>Rounded with waste</td><td>'+buy+' L</td></tr>';
 if(price>0)html+='<tr><td>Cost at '+price+'/L</td><td>'+num2(buy*price)+' (currency of the price you typed)</td></tr>';
 html+='<tr><td>If two coats are needed</td><td>'+Math.ceil(litres*2*1.1*10)/10+' L — dark→light, raw plaster, or un-tinted primer all demand it</td></tr>';
 html+='</tbody></table>';
 html+='<p class="meta">Ceiling? It is length×width = '+num2(l*w)+' m² more — the same maths, one extra row. The 10% waste figure is generous for rolling and mean for sprayers; textured walls eat paint faster than the tin promises.</p>';
 $('pt-out').innerHTML=html;}
$('pt-go').onclick=render;['pt-l','pt-w','pt-h','pt-open','pt-cov','pt-cost'].forEach(function(i){$(i).oninput=render;});render();`,
  seo: `<h2 class="section-title">Read the tin, not the slogan</h2>
  <p>Coverage figures are measured on smooth, primed walls under lab light — real rooms add texture, patch-repair and the roller that never gets into the corner. That is why this page separates the exact litres the maths asks for from the number you actually buy: the waste buffer and the two-coat row exist because the expensive mistake is never running out mid-wall, it is discovering the colour took three coats. Painters\' rule the spreadsheets omit: one coat is a rumour, two is a product.</p>`,
});

// ── 33. /alat/recipe — recipe scaler with real fractions ────────────────────
TOOLKIT.push({
  slug: 'recipe', ic: '🥘', name: 'Recipe Scaler',
  title: 'Recipe Scaler — Multiply Ingredients With Proper Fractions | Tukuk-OS',
  desc: 'Scale any recipe to any number of servings and get the amounts as real fractions (¾ tsp, not 0.75 tsp), parsed line by line in your browser.',
  hero: 'Recipe Scaler', sub: 'any factor · fractions rendered as ½ ⅓ ¾ · baking caveat printed',
  navBlurb: 'Halve, double or 2.5× a recipe and read the result as fractions a human measures with — ¾ tsp, not 0.75 tsp.',
  hubBlurb: 'paste the ingredient list, set servings from/to: every line rescaled to real spoon fractions, with the one baking rule that scales badly',
  lead: 'Recipe maths is easy; <b>kitchen-representable</b> maths is not. 0.75 teaspoons is correct and unusable — nobody turns a measuring spoon to 0.75. This page parses your ingredient lines, applies the factor, and renders the answer as the fractions your spoon set actually has (½, ⅓, ⅔, ¼, ¾, ⅛…), falling back to decimals for quantities above 10 where the teaspoon argument stops mattering.',
  form: `<textarea class="tl-in" id="rc-in" spellcheck="false" rows="5">2 cups flour
0.5 tsp salt
3 eggs</textarea>
<div class="tl-form">
  ${field('Recipe serves', '<input id="rc-from" type="number" min="1" step="any" value="8">')}
  ${field('You want', '<input id="rc-to" type="number" min="1" step="any" value="12">')}
  <button class="tl-btn primary" id="rc-go" type="button">Scale</button>
</div>
<div class="tl-res" id="rc-out">—</div>`,
  script: `
var $=function(id){return document.getElementById(id);};
function fracStr(v){
 if(v>=10)return (Math.round(v*10)/10).toString();
 var whole=Math.floor(v+1e-9),rem=v-whole;
 if(rem<0.03)return String(whole);
 if(rem>0.97)return String(whole+1);
 var UNI={'1/2':'½','1/3':'⅓','2/3':'⅔','1/4':'¼','3/4':'¾','1/6':'⅙','5/6':'⅚','1/8':'⅛','3/8':'⅜','5/8':'⅝','7/8':'⅞'};
 var best=null;
 for(var d=2;d<=8;d++){for(var n=1;n<d;n++){
  var e=Math.abs(rem-n/d);
  if(e<0.03&&(!best||e<best.e))best={e:e,s:UNI[n+'/'+d]||n+'/'+d};
 }}
 if(!best)return (Math.round(v*100)/100).toString();
 return (whole?whole+' ':'')+best.s;}
function render(){var lines=$('rc-in').value.split(/\\n/).filter(function(s){return s.trim();});
 var from=parseFloat($('rc-from').value),to=parseFloat($('rc-to').value);
 if(!(from>0)||!(to>0)){$('rc-out').innerHTML='<span class="tl-badge tl-no">check input</span> Both serving numbers must be positive.';return;}
 var f=to/from;
 var rows='',scaled=0,plain=0;
 for(var i=0;i<lines.length;i++){var line=lines[i].trim();
  var m=line.match(/^(\\d+(?:\\.\\d+)?|\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+)\\s+(.*)$/);
  if(!m){rows+='<tr><td colspan="2">'+line.replace(/&/g,'&amp;').replace(/</g,'&lt;')+'</td></tr>';plain++;continue;}
  var raw=m[1],val;
  if(raw.indexOf('/')>-1){var pm=raw.match(/(\\d+)?\\s*(\\d+)\\/(\\d+)/);val=(pm[1]?+pm[1]:0)+(+pm[2])/(+pm[3]);}
  else val=parseFloat(raw);
  scaled++;
  rows+='<tr><td>'+fracStr(val*f)+' '+m[2].replace(/&/g,'&amp;').replace(/</g,'&lt;')+'</td><td class="meta">was '+raw.replace(/\\s+/g,' ')+' '+m[2].replace(/&/g,'&amp;').replace(/</g,'&lt;')+'</td></tr>';}
 $('rc-out').innerHTML='<table class="tl-tab"><thead><tr><th>Scaled ×'+(Math.round(f*1000)/1000)+'</th><th></th></tr></thead><tbody>'+rows+'</tbody></table>'
 +'<p class="meta">'+scaled+' ingredient line'+(scaled===1?'':'s')+' rescaled'+(plain?', '+plain+' left as written (no leading number found — e.g. \"salt to taste\")':'')+'. Rounding lands on the nearest usable fraction within one eighth.</p>'
 +'<p class="meta">Cooking scales linearly; baking does not always: salt, yeast, baking powder and spice tolerate halving fine but a 5× batch needs proportionally <i>less</i> leavening and spice per flour (the reaction and the flavour compounds do not multiply politely). Scale, then smell at half-time.</p>';
}
$('rc-go').onclick=render;$('rc-in').oninput=render;$('rc-from').oninput=render;$('rc-to').oninput=render;render();`,
  seo: `<h2 class="section-title">Why the \"pinch\" line survives untouched</h2>
  <p>Lines without a leading number — salt to taste, one onion, juice of a lime — are not arithmetic failures, they are the recipe talking like a person. The scaler passes them through visibly instead of inventing quantities, because a page that confidently tells you to scale \"a pinch\" to \"0.1875 pinches\" is the page that ruins dinner. The same reason decimals stay under 10: nobody measures 12.75 cups of anything; they measure twelve and a three-quarter and stop fussing.</p>`,
});

// ── 34. /alat/printsize — pixels to print dimensions ────────────────────
TOOLKIT.push({
  slug: 'printsize', ic: '\ud83d\udda8', name: 'Print Size Calculator',
  title: 'Print Size Calculator — Pixels to Inches & cm at Any DPI | Tukuk-OS',
  desc: 'What size will this photo print: pixels to inches and centimetres at 300/150/72 DPI, the real megapixel count, and how far you must stand for it to look sharp.',
  hero: 'Print Size Calculator', sub: 'px \u00f7 dpi = inches \u00b7 cm conversion \u00b7 MP count \u00b7 viewing-distance rule',
  navBlurb: '3000×2000 prints 10×6.7 inches at 300 dpi — plus the honest physics of how big you can actually go before the dots show.',
  hubBlurb: 'does this file print poster-size? pixels divided by dpi, printed in inches and cm, with the viewing distance at which it still looks sharp',
  lead: 'Print resolution is a division, and the sharpness question is geometry: <b>inches = pixels \u00f7 dpi</b>, and the dpi a viewer needs depends on how far they stand. A magazine at 300 dpi is read at 30 cm; a billboard at roughly 30 dpi is read from 30 m — and at that distance the eye literally cannot resolve the dots. This page gives you both halves: the size at your dpi, and the size at your viewing distance.',
  form: `<div class="tl-form">
  ${field('Width (px)', '<input id="py-w" type="number" min="1" step="1" value="3000">')}
  ${field('Height (px)', '<input id="py-h" type="number" min="1" step="1" value="2000">')}
  ${field('Print DPI', '<input id="py-dpi" type="number" min="10" max="2400" step="any" value="300">')}
  <button class="tl-btn primary" id="py-go" type="button">Calculate</button>
</div>
<div class="tl-res" id="py-out">\u2014</div>`,
  script: `
var $=function(id){return document.getElementById(id);};
function f1(v){return (Math.round(v*10)/10).toLocaleString('en-US',{maximumFractionDigits:1});}
function render(){var w=Number($('py-w').value),h=Number($('py-h').value),dpi=parseFloat($('py-dpi').value);
 if(!(w>=1)||!(h>=1)||!(dpi>=10&&dpi<=2400)){$('py-out').innerHTML='<span class="tl-badge tl-no">check input</span> Pixel sizes from 1 up, DPI between 10 and 2,400.';return;}
 var wi=w/dpi,hi=h/dpi;
 $('py-out').innerHTML='<div class="tl-big">'+f1(wi)+' \u00d7 '+f1(hi)+' in</div>'
 +'<table class="tl-tab"><tbody>'
 +'<tr><td>At '+f1(dpi)+' dpi</td><td>'+f1(wi)+' \u00d7 '+f1(hi)+' in = '+f1(wi*2.54)+' \u00d7 '+f1(hi*2.54)+' cm</td></tr>'
 +'<tr><td>Same file at 300 dpi</td><td>'+f1(w/300)+' \u00d7 '+f1(h/300)+' in \u2014 the gallery print standard</td></tr>'
 +'<tr><td>Same file at 150 dpi</td><td>'+f1(w/150)+' \u00d7 '+f1(h/150)+' in \u2014 fine for A3 held at arm\u2019s length</td></tr>'
 +'<tr><td>Resolution</td><td>'+f1(w*h/1e6)+' megapixels</td></tr>'
 +'<tr><td>Sharp to the eye at</td><td>\u2248 '+f1(dpi/3.4)+' cm or further away (60/20 vision resolves ~1 arcminute; dot pitch \u00f7 that is this formula)</td></tr>'
 +'</tbody></table>'
 +'<p class="meta">Printers do not scale up for free: pushing 72 dpi to 300 is interpolation, not detail. But down-sizing is lossless-ish, and the viewing-distance row is why a 6-megapixel file makes a perfectly sharp A3 and a very convincing poster \u2014 nobody is reading a poster with their nose on it.</p>';}
$('py-go').onclick=render;['py-w','py-h','py-dpi'].forEach(function(i){$(i).oninput=render;});render();`,
  seo: `<h2 class="section-title">The arc-minute is doing all the work</h2>
  <p>Standard visual acuity resolves about one arcminute \u2014 at 25 cm that is a dot pitch of roughly 0.073 mm, which is where the 300-dpi magazine convention comes from: it is the resolution at which printing becomes invisible to reading distance, not a magic number the ink invented. Double the viewing distance and you can halve the dpi, which is why signage shops print huge murals at 50\u2013100 dpi and billboard operators laugh at the word dpi entirely. \u201c300 dpi required\u201d is therefore half the answer: always ask \u201cat what distance?\u201d.</p>`,
});

// ── 35. /alat/electricity — watts to cost ──────────────────────────────────
TOOLKIT.push({
  slug: 'electricity', ic: '\ud83d\udca1', name: 'Electricity Cost Calculator',
  title: 'Electricity Cost Calculator — Watts, Hours and Tariff to Real Money | Tukuk-OS',
  desc: 'What any appliance actually costs to run: watts \u00d7 hours to kWh, times your tariff, with the yearly figure and the standby-power trap explained.',
  hero: 'Electricity Cost Calculator', sub: 'W \u00d7 h \u00f7 1000 = kWh \u00b7 your tariff \u00b7 yearly view \u00b7 standby trap',
  navBlurb: 'The real money an appliance burns: watts-hours to kWh, your own tariff, the annual figure, and what that always-on standby light actually costs.',
  hubBlurb: 'is the old fridge worth replacing? watts \u00d7 hours \u00d7 your tariff to a kWh figure and an annual cost, standby included',
  lead: 'One formula, honest inputs: <b>energy (kWh) = watts \u00d7 hours \u00f7 1,000</b>, cost = energy \u00d7 your tariff. The two numbers people get wrong are the tariff (use the all-in rate on your bill, not the headline) and duty cycle (a fridge\u2019s compressor does not run 24 h \u2014 it runs maybe 8 of them). Both rows below warn you about themselves.',
  form: `<div class="tl-form">
  ${field('Power (watts)', '<input id="el-w" type="number" min="0.1" step="any" value="100">')}
  ${field('Hours per day', '<input id="el-hrs" type="number" min="0" max="24" step="any" value="8">')}
  ${field('Days', '<input id="el-days" type="number" min="1" max="365" step="1" value="30">')}
  ${field('Tariff per kWh', '<input id="el-tar" type="number" min="0" step="any" value="0.50">')}
  <button class="tl-btn primary" id="el-go" type="button">Calculate</button>
</div>
<div class="tl-res" id="el-out">\u2014</div>`,
  script: `
var $=function(id){return document.getElementById(id);};
function n2(v){return (Math.round(v*100)/100).toLocaleString('en-US',{maximumFractionDigits:2});}
function render(){var w=parseFloat($('el-w').value),hrs=parseFloat($('el-hrs').value),days=Number($('el-days').value),tar=parseFloat($('el-tar').value);
 if(!(w>0)||!(hrs>=0&&hrs<=24)||!Number.isInteger(days)||days<1||days>365||!(tar>=0)){$('el-out').innerHTML='<span class="tl-badge tl-no">check input</span> Watts above 0, hours 0\u201324, days 1\u2013365, tariff 0 or more.';return;}
 var kwh=w*hrs*days/1000,cost=kwh*tar;
 var yr=w*hrs*365/1000;
 $('el-out').innerHTML='<div class="tl-big">'+n2(cost)+' <span class="meta" style="font-size:1rem">over '+days+' day'+(days===1?'':'s')+' ('+n2(kwh)+' kWh)</span></div>'
 +'<table class="tl-tab"><tbody>'
 +'<tr><td>Per day</td><td>'+n2(w*hrs/1000)+' kWh \u00b7 '+n2(w*hrs/1000*tar)+'</td></tr>'
 +'<tr><td>If run all year</td><td>'+n2(yr)+' kWh \u00b7 '+n2(yr*tar)+'</td></tr>'
 +'<tr><td>For '+days+' days</td><td>'+n2(kwh)+' kWh \u00b7 '+n2(cost)+'</td></tr>'
 +'</tbody></table>'
 +'<p class="meta">Rating \u2260 consumption: a 65 W laptop charger sips 20\u201340 W in practice, a resistive heater (kettle, oven, iron) really does pull its full watts. Fridges and pumps list a duty cycle \u2014 use the average watts from the label or a plug-in meter if you have one. And yes: the standby LED on that \u201c100 W\u201d old TV is 8 W \u2014 '+n2(8*24*365/1000*tar)+' a year of paying to glow.</p>';}
$('el-go').onclick=render;['el-w','el-hrs','el-days','el-tar'].forEach(function(i){$(i).oninput=render;});render();`,
  seo: `<h2 class="section-title">The tariff is the whole answer</h2>
  <p>The same fan can cost four times as much to run in one country as another \u2014 which is why the tariff field is yours to fill and this page never ships a default national rate. Check your latest bill\u2019s total: divide the amount due by the kWh used and you get the all-in rate (energy + network + taxes + levies), the only number that reflects what a real extra kWh costs you. Time-of-use tariffs change the maths again: the EV charged at midnight is not the same kWh as the oven at 7 p.m.</p>`,
});

// ── 36. /alat/pace — running pace & race splits ────────────────────────────
TOOLKIT.push({
  slug: 'pace', ic: '\ud83c\udfc3', name: 'Running Pace Calculator',
  title: 'Running Pace Calculator — Pace per KM, Splits & Race Prediction | Tukuk-OS',
  desc: 'Distance and time in: pace per km and mile, speed, even-pace splits for 5K to marathon, and the Riegel formula prediction for the longer races.',
  hero: 'Running Pace Calculator', sub: 'pace \u00b7 splits \u00b7 km/h and min/mi \u00b7 Riegel \u00d7d^1.06 prediction',
  navBlurb: 'Pace per km and mile, even splits from 5K to marathon, and the Riegel 1.06 prediction with its honest warning about the wall.',
  hubBlurb: 'a 25-minute 5K is 5:00/km \u2014 until it is not: even splits, and the Riegel-formula marathon prediction that admits the wall exists',
  lead: 'The watch face maths, done properly: <b>pace = time \u00f7 distance</b>, printed per kilometre <i>and</i> per mile because runners live in both units. Splits assume even pacing, which is what a GPS watch promises you; the longer-race prediction then uses <b>Riegel\u2019s formula</b> T\u2082 = T\u2081 \u00d7 (D\u2082/D\u2081)^1.06 because doubling distance has cost a little more than double time since 1981 and every sports-math textbook.',
  form: `<div class="tl-form">
  ${field('Distance (km)', '<input id="pc-dist" type="number" min="0.1" max="200" step="any" value="5">')}
  ${field('Hours', '<input id="pc-h" type="number" min="0" max="23" step="1" value="0">')}
  ${field('Minutes', '<input id="pc-m" type="number" min="0" max="59" step="1" value="25">')}
  ${field('Seconds', '<input id="pc-s" type="number" min="0" max="59" step="1" value="0">')}
  <button class="tl-btn primary" id="pc-go" type="button">Calculate</button>
</div>
<div class="tl-res" id="pc-out">\u2014</div>`,
  script: `
var $=function(id){return document.getElementById(id);};
function hms(s){s=Math.round(s);var h=Math.floor(s/3600),m=Math.floor(s%3600/60),ss=s%60;
 var mm=(h?String(m).padStart(2,'0'):String(m));
 return (h?h+':':'')+mm+':'+String(ss).padStart(2,'0');}
function render(){var d=parseFloat($('pc-dist').value),secs=Number($('pc-h').value)*3600+Number($('pc-m').value)*60+Number($('pc-s').value);
 if(!(d>0)||!(secs>0)||secs>24*3600){$('pc-out').innerHTML='<span class="tl-badge tl-no">check input</span> Distance above 0 km, total time between 1 second and 24 hours.';return;}
 var pace=secs/d,mi=1.609344;
 var RACES=[[5,'5K'],[10,'10K'],[21.0975,'Half'],[42.195,'Marathon']];
 var rows='';
 RACES.forEach(function(r){if(r[0]<=d)return;
  var even=pace*r[0],riegel=secs*Math.pow(r[0]/d,1.06);
  rows+='<tr><td>'+r[1]+'</td><td>'+hms(even)+'</td><td>'+hms(riegel)+'</td></tr>';});
 $('pc-out').innerHTML='<div class="tl-big">'+hms(pace)+' <span class="meta" style="font-size:1rem">per km</span></div>'
 +'<table class="tl-tab"><tbody>'
 +'<tr><td>Pace per mile</td><td>'+hms(pace*mi)+' /mi</td></tr>'
 +'<tr><td>Speed</td><td>'+(d/(secs/3600)).toFixed(1)+' km/h ('+(d/(secs/3600)/mi).toFixed(1)+' mph)</td></tr>'
 +'</tbody></table>'
 +(rows?'<p class="meta">Predictions for races longer than the one you ran:</p><table class="tl-tab"><thead><tr><th>Race</th><th>Even pace</th><th>Riegel formula</th></tr></thead><tbody>'+rows+'</tbody></table>':'')
 +'<p class="meta">Even pace is the lie the watch tells; Riegel\u2019s exponent 1.06 is the lie the science tells \u2014 the real drift depends on where you got fit. Trained marathoners lose only 2\u20134% per doubling past the half; under-trained ones hit the wall and lose 20%. Treat the Riegel column as the optimistic ceiling, not the plan.</p>';
}
$('pc-go').onclick=render;['pc-dist','pc-h','pc-m','pc-s'].forEach(function(i){$(i).oninput=render;});render();`,
  seo: `<h2 class="section-title">Where the 1.06 came from</h2>
  <p>Peter Riegel fitted thousands of race results in 1981 and found performance decays predictably with distance \u2014 T\u2082 = T\u2081 \u00d7 (D\u2082/D\u2081)^1.06 \u2014 exponent 1.0 being pure linear scaling, the extra 0.06 being physiology. Later studies put the exponent between 1.03 and 1.14 depending on the population and the heat. That spread is the whole story: the formula predicts the shape of the decay, not your race; it assumes training depth behind the shorter time. Use the split column to pace, and the wall column as a warning.</p>`,
});

// ── 37. /alat/design — the browser-local poster studio (Canva-lite) ────────
TOOLKIT.push({
  slug: 'design', ic: '\ud83c\udfa8', name: 'Design Studio',
  title: 'Free Online Design Studio — Poster & Social Image Maker, No Account | Tukuk-OS',
  desc: 'A Canva-style studio that runs entirely in your browser: eight templates, align, lock, flip, emoji stickers, undo, drag handles, snap guides, styled text, image layers, autosave and PNG, JPG or WebP export up to 4×. No sign-up, nothing uploaded.',
  hero: 'Design Studio', sub: 'templates · align · lock · flip · stickers · undo · snap · PNG/JPG/WebP · zero uploads',
  navBlurb: 'The poster maker without the login wall: eight starter templates, real layer editing with drag handles, rotation, snapping, one-click alignment, lock and flip, undo history, autosave and PNG/JPG/WebP export up to 4×.',
  hubBlurb: 'make the social image yourself: templates, layered text/shapes/photos, align-lock-flip-stickers, undo, autosave, PNG-JPG-WebP export — and your file never leaves the tab',
  lead: 'A design tool should be a canvas, a layer stack and an export button — and this page has all three, plus the things that make them usable: <b>eight starter templates</b> built from real layer maths, <b>drag handles</b> to resize and a knob to rotate, <b>snap-to-grid</b> with centre and rule-of-thirds guides, one-click <b>alignment</b> to every edge and centre, <b>layer lock and image flip</b> so a finished corner stops moving, <b>emoji stickers</b> that export as drawn, <b>undo and redo</b> (40 steps, or Ctrl+Z), a <b>layer list</b> you can pick, hide and reorder, <b>autosave</b> to your browser so a refresh does not eat the work, and export as <b>PNG (transparent), JPG or WebP at up to 4×</b> — with a one-click <b>Copy PNG</b> for pasting straight into a chat. Keyboard: arrows nudge, Shift+arrows ×10, Ctrl+D duplicates, Ctrl+Z/Y undo/redo, Ctrl+S downloads, Alt+click cycles layers. Everything is composited by your own browser — there is <b>no account, no watermark, no upload</b>; close the tab and the document is gone for good.',
  css: `
.ds-bar,.ds-tools,.ds-edit{display:flex;flex-wrap:wrap;gap:.6rem;align-items:flex-end;margin:.7rem 0}
.ds-bar label,.ds-edit label{display:flex;flex-direction:column;font-size:.78rem;gap:.2rem}
.ds-bar input,.ds-bar select,.ds-edit input,.ds-edit select{min-width:4.5rem}
.ds-edit input[type=color]{padding:1px;height:2rem}
.ds-check{display:flex;flex-direction:row;align-items:center;gap:.35rem;font-size:.8rem}
#ds-canvas{display:block;margin:.5rem auto;border:1px solid #334155;border-radius:.5rem;max-width:100%;touch-action:none;cursor:crosshair;background:#000}
.ds-tools button,.ds-imgbtn{background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:.4rem;padding:.45rem .8rem;cursor:pointer;font-size:.85rem}
.ds-tools button:hover,.ds-imgbtn:hover{background:#334155}
.ds-imgbtn input{display:none}
#ds-sel{margin-left:auto;font-size:.8rem}
#ds-layers{display:flex;flex-direction:column;gap:.25rem;margin:.4rem 0}
.ds-lay{display:flex;align-items:center;gap:.5rem;background:#111d2e;border:1px solid #24344a;border-radius:.35rem;padding:.3rem .55rem;cursor:pointer;font-size:.82rem}
.ds-lay.on{border-color:#38bdf8;background:#152a3d}
.ds-lay .ds-eye{background:none;border:none;padding:0 .2rem;cursor:pointer;font-size:.9rem;color:#94a3b8}
.ds-lay .ds-nm{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ds-lay .ds-kd{color:#64748b;font-size:.72rem}
.ds-tools select{padding:.4rem .5rem;border-radius:.4rem;background:#1e293b;color:#e2e8f0;border:1px solid #334155;font-size:.85rem}
#ds-align{display:inline-flex;gap:.25rem;align-items:center;margin-left:.4rem}
#ds-align button{padding:.4rem .5rem;min-width:2rem}
`,
  form: `<div class="ds-bar">
  ${field('Canvas', '<select id="ds-size"><option value="1080x1080" selected>Instagram post · 1080×1080</option><option value="1080x1920">Story / Reel · 1080×1920</option><option value="1080x1350">Portrait post · 1080×1350</option><option value="1280x720">YouTube thumbnail · 1280×720</option><option value="1200x630">Share card (OG) · 1200×630</option><option value="1240x1754">A4 portrait · 1240×1754</option><option value="custom">Custom…</option></select>')}
  ${field('W', '<input id="ds-w" type="number" min="100" max="4000" step="10" value="1080">')}
  ${field('H', '<input id="ds-h" type="number" min="100" max="4000" step="10" value="1080">')}
  ${field('BG colour', '<input id="ds-bga" type="color" value="#0f172a">')}
  ${field('BG accent', '<input id="ds-bgb" type="color" value="#7c3aed">')}
  ${field('Background', '<select id="ds-bgs"><option value="solid">solid</option><option value="vgrad" selected>vertical gradient</option><option value="dgrad">diagonal gradient</option><option value="radial">radial glow</option></select>')}
  ${field('Template', '<select id="ds-tpl"><option value="">choose a starter…</option><option value="hero">Bold hero</option><option value="quote">Quote card</option><option value="badge">Announcement + sticker</option><option value="thumb">Thumbnail headline</option><option value="minimal">Minimal bar</option><option value="thirds">Grid thirds</option><option value="sale">Sale burst</option><option value="cover">Podcast cover</option></select>')}
  <button type="button" id="ds-undo" title="Ctrl+Z">Undo</button>
  <button type="button" id="ds-redo" title="Ctrl+Y">Redo</button>
</div>
<canvas id="ds-canvas"></canvas>
<div class="ds-tools">
  <button type="button" id="ds-addtext">+ Text</button>
  <button type="button" id="ds-addrect">+ Rectangle</button>
  <button type="button" id="ds-addround">+ Rounded</button>
  <button type="button" id="ds-addcircle">+ Circle</button>
  <button type="button" id="ds-addring">+ Ring</button>
  <button type="button" id="ds-addtri">+ Triangle</button>
  <button type="button" id="ds-addline">+ Line</button>
  <button type="button" id="ds-addstar">+ Star</button>
  <select id="ds-emo" title="sticker picker"><option value="🎉" selected>🎉</option><option value="❤️">❤️</option><option value="🔥">🔥</option><option value="✨">✨</option><option value="😂">😂</option><option value="👍">👍</option><option value="🙏">🙏</option><option value="💯">💯</option><option value="🎯">🎯</option><option value="🚀">🚀</option><option value="⭐">⭐</option><option value="🎈">🎈</option><option value="🏆">🏆</option><option value="💡">💡</option><option value="✅">✅</option><option value="❌">❌</option><option value="👀">👀</option><option value="🎧">🎧</option></select>
  <button type="button" id="ds-addsticker">+ Sticker</button>
  <label class="ds-imgbtn">+ Image<input type="file" id="ds-img" accept="image/*"></label>
  <button type="button" id="ds-dup">Duplicate</button>
  <button type="button" id="ds-back">Send back</button>
  <button type="button" id="ds-fwd">Bring forward</button>
  <button type="button" id="ds-del">Delete</button>
  <button type="button" id="ds-lock" title="lock the selected layer against moves and deletes">Lock</button>
  <button type="button" id="ds-fliph" title="flip horizontally">Flip H</button>
  <button type="button" id="ds-flipv" title="flip vertically">Flip V</button>
  <span id="ds-align" title="align the selected layer on the canvas">
    <button type="button" id="ds-al-l" title="align left">L</button>
    <button type="button" id="ds-al-c" title="centre horizontally">CX</button>
    <button type="button" id="ds-al-r" title="align right">R</button>
    <button type="button" id="ds-al-t" title="align top">T</button>
    <button type="button" id="ds-al-m" title="centre vertically">CY</button>
    <button type="button" id="ds-al-b" title="align bottom">B</button>
  </span>
  <span id="ds-sel" class="meta">nothing selected</span>
</div>
<div id="ds-layers"></div>
<div class="ds-bar">
  <label class="ds-check"><input id="ds-snap" type="checkbox" checked> snap to grid + centre</label>
  <label class="ds-check"><input id="ds-guides" type="checkbox" checked> show guides</label>
  ${field('Grid', '<select id="ds-grid"><option value="24">24 px</option><option value="40" selected>40 px</option><option value="60">60 px</option><option value="108">108 px</option></select>')}
  ${field('Auto-save', '<select id="ds-auto"><option value="1" selected>on (this browser)</option><option value="0">off</option></select>')}
  <button type="button" id="ds-save">Save design file</button>
  <label class="ds-imgbtn">Open design file<input type="file" id="ds-open" accept="application/json,.json"></label>
  <button type="button" id="ds-restore">Restore last session</button>
</div>
<div class="ds-edit">
  ${field('Text', '<input id="ds-txt" type="text" value="" disabled>')}
  ${field('Font', '<select id="ds-font"><option value="Impact,Charcoal,sans-serif">Impact</option><option value="Georgia,serif" selected>Georgia</option><option value="Helvetica,Arial,sans-serif">Helvetica</option><option value="Trebuchet MS,sans-serif">Trebuchet</option><option value="Courier New,monospace">Courier</option><option value="Arial Black,Arial,sans-serif">Arial Black</option><option value="Verdana,Geneva,sans-serif">Verdana</option></select>')}
  ${field('Weight', '<select id="ds-wt"><option value="400">regular</option><option value="700" selected>bold</option></select>')}
  ${field('Style', '<select id="ds-fst"><option value="n" selected>normal</option><option value="i">italic</option></select>')}
  ${field('Align', '<select id="ds-tal"><option value="c" selected>centre</option><option value="l">left</option><option value="r">right</option></select>')}
  ${field('Size', '<input id="ds-ps" type="number" min="8" max="600" step="1" value="64">')}
  ${field('Line %', '<input id="ds-lh" type="number" min="80" max="250" step="5" value="118">')}
  ${field("Track", '<input id="ds-ls" type="number" min="-10" max="60" step="1" value="0">')}
  ${field('Colour', '<input id="ds-col" type="color" value="#ffffff">')}
  ${field('Second (fill)', '<input id="ds-col2" type="color" value="#22d3ee">')}
  ${field('Fill', '<select id="ds-fill"><option value="s" selected>solid</option><option value="g">gradient</option></select>')}
  ${field('Stroke', '<input id="ds-st" type="number" min="0" max="80" step="1" value="0">')}
  ${field('Corner', '<input id="ds-rad" type="number" min="0" max="500" step="2" value="0">')}
  ${field('Shadow', '<input id="ds-sh" type="number" min="0" max="120" step="2" value="0">')}
  ${field('Opacity %', '<input id="ds-op" type="range" min="5" max="100" value="100">')}
  ${field('Scale %', '<input id="ds-sc" type="range" min="10" max="800" value="100">')}
  ${field('Rotate °', '<input id="ds-rot" type="range" min="-180" max="180" value="0">')}
  ${field('Format', '<select id="ds-fmt"><option value="png" selected>PNG (transparent)</option><option value="jpg">JPG (smaller)</option><option value="webp">WebP</option></select>')}
  ${field('Export', '<select id="ds-scale"><option value="1">1×</option><option value="2" selected>2×</option><option value="3">3×</option><option value="4">4×</option></select>')}
  <button class="tl-btn primary" id="ds-dl" type="button">Download</button>
  <button type="button" id="ds-clip" title="copy the design as PNG to your clipboard">Copy PNG</button>
  <button type="button" id="ds-clear">Clear canvas</button>
</div>
<div class="tl-res meta" id="ds-out">Click a layer to select it, drag its body to move, drag a corner handle to resize, drag the knob above it to rotate. Arrows nudge one grid step, Shift+arrows nudge ten steps, Ctrl+Z undoes, Ctrl+Y redoes. Everything stays inside this tab.</div>`,
  script: `
var $=function(id){return document.getElementById(id);};
var cv=$('ds-canvas');
var cx=(cv&&cv.getContext)?cv.getContext('2d'):null;
var W=1080,H=1080,layers=[],sel=-1,seq=0,hist=[],future=[],acts=[],dsD=1,noGuide=false,mode='',grab=null,expK=1,expMode=false;
function num(v,d){v=parseFloat(v);return isNaN(v)?d:v;}
function hex(v){return /^#[0-9a-fA-F]{6}$/.test(v)?v:'#000000';}
function chk(id){var e=$(id);return !!(e&&e.checked);}
function gsz(){return num($('ds-grid').value,40);}
function snapV(v){return Math.round(v/gsz())*gsz();}
function deg(r){return r*180/Math.PI;}
function dist(ax,ay,bx,by){var dx=ax-bx,dy=ay-by;return Math.sqrt(dx*dx+dy*dy);}
function norm(a){a%=360;if(a>180)a-=360;if(a<-180)a+=360;return a;}
function fontOf(l){return (l.italic?'italic ':'')+(l.weight||700)+' '+Math.round(l.size)+'px '+l.font;}
function push(){try{hist.push(JSON.stringify(ser()));if(hist.length>40)hist.shift();future.length=0;}catch(e){}}
function undo(){if(!hist.length)return;try{var j=hist[hist.length-1];future.push(JSON.stringify(ser()));if(future.length>40)future.pop();loadJson(JSON.parse(j));hist.pop();}catch(e){}}
function redo(){if(!future.length)return;try{var j=future.pop();hist.push(JSON.stringify(ser()));loadJson(JSON.parse(j));}catch(e){}}
function ser(){return {w:W,h:H,a:$('ds-bga').value,b:$('ds-bgb').value,s:$('ds-bgs').value,
 layers:layers.map(function(l){var o={kind:l.kind,name:l.name,x:l.x,y:l.y,rot:l.rot,op:l.op,scale:l.scale,hidden:l.hidden,
  size:l.size,color:l.color,fill:l.fill,col2:l.col2,stroke:l.stroke,shadow:l.shadow,rad:l.rad,text:l.text,font:l.font,
  weight:l.weight,italic:l.italic,align:l.align,lh:l.lh,ls:l.ls,lock:!!l.lock,fliph:!!l.fliph,flipv:!!l.flipv};
  if(l.kind==='img'){o.src=l.src||'';o.imgW=l.imgW;o.imgH=l.imgH;}return o;})};}
function loadJson(d){if(!d||!d.layers)return -1;
 if(num(d.w,0)>=100&&num(d.h,0)>=100){W=d.w;H=d.h;$('ds-w').value=W;$('ds-h').value=H;$('ds-size').value='custom';}
 if(d.a)$('ds-bga').value=d.a;if(d.b)$('ds-bgb').value=d.b;if(d.s)$('ds-bgs').value=d.s;
 layers=[];var n=0;
 d.layers.forEach(function(x){
  if(x.kind==='img'){if(!x.src||typeof Image==='undefined')return;
   var im=new Image();im.src=x.src;
   x.img=im;x.imgW=x.imgW||x.size||200;x.imgH=x.imgH||x.size||200;x.src=x.src;
   x.id=++seq;layers.push(x);n++;return;}
  x.id=++seq;layers.push(x);n++;});
 select(n?layers.length-1:-1);return n;}
function autosave(){if($('ds-auto').value!=='1')return;
 try{if(typeof localStorage!=='undefined')localStorage.setItem('tukuk-design-v2',JSON.stringify(ser()));}catch(e){}}
function stash(){if(typeof setTimeout==='undefined')return;setTimeout(autosave,400);}
var TPL={
 hero:function(){return {s:'dgrad',layers:[
  {kind:'ellipse',name:'corner glow',size:Math.round(W*0.5),x:Math.round(W*0.85),y:Math.round(H*0.15),op:35},
  {kind:'text',name:'headline',text:'Big idea,\\nsmall screen',font:'Impact,Charcoal,sans-serif',size:Math.max(30,Math.round(W/9)),lh:112},
  {kind:'line',name:'underline',size:Math.round(W*0.5),y:Math.round(H*0.72),stroke:Math.max(6,Math.round(W/120))},
  {kind:'text',name:'kicker',text:'tukuk.org design studio',weight:400,size:Math.max(16,Math.round(W/34)),y:Math.round(H*0.84),op:85}]};},
 quote:function(){return {a:'#0f172a',b:'#0f172a',s:'solid',layers:[
  {kind:'text',name:'mark',text:'\\u201c',font:'Georgia,serif',size:Math.round(W*0.5),y:Math.round(H*0.24),op:22},
  {kind:'text',name:'quote',text:'The best time to see\\nsomething new is today.',font:'Georgia,serif',weight:400,italic:true,size:Math.max(26,Math.round(W/15)),y:Math.round(H*0.55),lh:150},
  {kind:'ring',name:'ring',size:Math.round(W*0.86),op:16,stroke:Math.max(4,Math.round(W/260))}]};},
 badge:function(){return {layers:[
  {kind:'rect',name:'band',size:Math.round(W*0.86),y:Math.round(H*0.45),rad:Math.round(W/26),fill:'g',op:95},
  {kind:'text',name:'news',text:'NEW',font:'Impact,Charcoal,sans-serif',size:Math.round(W/6),y:Math.round(H*0.45)},
  {kind:'text',name:'caption',text:'drop everything and look',weight:400,size:Math.max(18,Math.round(W/26)),y:Math.round(H*0.62),op:90},
  {kind:'star',name:'sticker',size:Math.round(W*0.2),x:Math.round(W*0.82),y:Math.round(H*0.8),rot:15,fill:'g'}]};},
 thumb:function(){return {a:'#111827',b:'#dc2626',s:'dgrad',layers:[
  {kind:'rect',name:'bar',size:Math.round(W*0.92),y:Math.round(H*0.78),op:90,rad:Math.round(W/60)},
  {kind:'text',name:'headline',text:'I BUILT THIS\\nIN ONE TAB',font:'Impact,Charcoal,sans-serif',size:Math.round(W/8),y:Math.round(H*0.38),lh:105,shadow:Math.round(W/60)},
  {kind:'text',name:'subline',text:'no account \\u00b7 no upload \\u00b7 no watermark',weight:400,size:Math.max(18,Math.round(W/38)),y:Math.round(H*0.78)}]};},
 minimal:function(){return {a:'#f8fafc',b:'#0f172a',s:'solid',layers:[
  {kind:'line',name:'rule',size:Math.round(W*0.7),y:Math.round(H*0.38),color:'#0f172a',stroke:Math.max(3,Math.round(W/300))},
  {kind:'text',name:'title',text:'Less, but better',font:'Helvetica,Arial,sans-serif',weight:400,size:Math.round(W/11),y:Math.round(H*0.5),color:'#0f172a'},
  {kind:'text',name:'note',text:'one line says the rest',weight:400,size:Math.max(16,Math.round(W/30)),y:Math.round(H*0.62),color:'#475569'}]};},
 thirds:function(){return {layers:[
  {kind:'rect',name:'block one',size:Math.round(W*0.6),x:Math.round(W*0.33),y:Math.round(H*0.33),op:90},
  {kind:'ellipse',name:'block two',size:Math.round(W*0.42),x:Math.round(W*0.68),y:Math.round(H*0.62),fill:'g'},
  {kind:'text',name:'caption',text:'rule of thirds,\\nnot vibes',font:'Trebuchet MS,sans-serif',size:Math.max(24,Math.round(W/16)),y:Math.round(H*0.86),lh:130}]};},
 sale:function(){return {a:'#fff7ed',b:'#dc2626',s:'vgrad',layers:[
  {kind:'text',name:'sale word',text:'MEGA\\nSALE',font:'Impact,Charcoal,sans-serif',size:Math.round(W/5),color:'#dc2626',lh:95,shadow:Math.round(W/90)},
  {kind:'star',name:'burst',size:Math.round(W*0.34),x:Math.round(W*0.78),y:Math.round(H*0.18),rot:-12,color:'#ffffff',col2:'#facc15',fill:'g'},
  {kind:'text',name:'offer',text:'up to 50% off everything',weight:400,size:Math.max(22,Math.round(W/14)),y:Math.round(H*0.74),color:'#7c2d12'},
  {kind:'line',name:'base rule',size:Math.round(W*0.8),y:Math.round(H*0.86),color:'#7c2d12',stroke:Math.max(5,Math.round(W/150))}]};},
 cover:function(){return {a:'#0b1220',b:'#22d3ee',s:'radial',layers:[
  {kind:'ring',name:'halo',size:Math.round(W*0.9),op:25,stroke:Math.max(6,Math.round(W/120))},
  {kind:'ellipse',name:'orb',size:Math.round(W*0.42),y:Math.round(H*0.3),op:90},
  {kind:'text',name:'show',text:'The Deep\\nSignal',font:'Georgia,serif',size:Math.max(30,Math.round(W/10)),y:Math.round(H*0.66),lh:110},
  {kind:'text',name:'episode',text:'new episode · every friday',weight:400,size:Math.max(16,Math.round(W/28)),y:Math.round(H*0.85),op:80}]};}};
function useTpl(){var k=$('ds-tpl').value,T=TPL[k];if(!T)return;
 push();var t=T();
 $('ds-bga').value=t.a||hex($('ds-bga').value);$('ds-bgb').value=t.b||hex($('ds-bgb').value);$('ds-bgs').value=t.s||$('ds-bgs').value;
 layers=[];var B=hex($('ds-bgb').value);
 t.layers.forEach(function(l){
  l.color=l.color||'#ffffff';l.col2=l.col2||B;l.fill=l.fill||'s';l.stroke=l.stroke||0;l.shadow=l.shadow||0;l.rad=l.rad||0;
  l.rot=l.rot||0;l.op=l.op==null?100:l.op;l.scale=l.scale||100;l.hidden=false;l.id=++seq;
  l.weight=l.weight||700;l.italic=l.italic||false;l.align=l.align||'c';l.lh=l.lh||118;l.ls=l.ls||0;
  l.font=l.font||$('ds-font').value;if(l.text===undefined)l.text='';
  l.x=l.x||Math.round(W/2);l.y=l.y||Math.round(H/2);layers.push(l);});
 select(layers.length-1);stash();
 $('ds-out').textContent='Template loaded: '+k+' — every layer is editable, and Undo brings the old stack back.';}
function draw(){
 if(!cx)return;
 if(!expMode){
  var vw=(typeof window!=='undefined'&&window.innerWidth)?Math.min(window.innerWidth-70,760):760;
  dsD=Math.min(vw/W,(vw*1.35)/H);
  cv.style.width=Math.round(W*dsD)+'px';cv.style.height=Math.round(H*dsD)+'px';
  if(cv.width!==W)cv.width=W;if(cv.height!==H)cv.height=H;}
 var A=hex($('ds-bga').value),B=hex($('ds-bgb').value),st=$('ds-bgs').value;
 cx.setTransform(expK,0,0,expK,0,0);cx.globalAlpha=1;cx.setLineDash([]);cx.shadowBlur=0;
 if(st==='solid'){cx.fillStyle=A;cx.fillRect(0,0,W,H);}
 else{var g=st==='radial'?cx.createRadialGradient(W/2,H*0.42,10,W/2,H*0.42,Math.max(W,H)*0.75)
   :cx.createLinearGradient(0,0,st==='dgrad'?W:0,st==='dgrad'?H:H);
  if(st==='radial'){g.addColorStop(0,B);g.addColorStop(1,A);}else{g.addColorStop(0,A);g.addColorStop(1,B);}
  cx.fillStyle=g;cx.fillRect(0,0,W,H);}
 for(var i=0;i<layers.length;i++)drawLayer(layers[i],i===sel&&sel>=0);
 if(!noGuide&&chk('ds-guides'))drawGuides();
 cx.setTransform(expK,0,0,expK,0,0);cx.globalAlpha=1;cx.setLineDash([]);cx.shadowBlur=0;
}
function drawGuides(){
 cx.strokeStyle='rgba(148,163,184,0.4)';cx.lineWidth=1;cx.setLineDash([]);
 var g=gsz(),x,y;
 for(x=g;x<W;x+=g){cx.beginPath();cx.moveTo(x,0);cx.lineTo(x,H);cx.stroke();}
 for(y=g;y<H;y+=g){cx.beginPath();cx.moveTo(0,y);cx.lineTo(W,y);cx.stroke();}
 cx.strokeStyle='rgba(56,189,248,0.65)';cx.lineWidth=Math.max(2,W/500);
 cx.beginPath();cx.moveTo(W/2,0);cx.lineTo(W/2,H);cx.stroke();
 cx.beginPath();cx.moveTo(0,H/2);cx.lineTo(W,H/2);cx.stroke();
 cx.strokeStyle='rgba(56,189,248,0.3)';cx.setLineDash([14,12]);
 var t=[W/3,W*2/3,H/3,H*2/3];
 cx.beginPath();cx.moveTo(t[0],0);cx.lineTo(t[0],H);cx.moveTo(t[1],0);cx.lineTo(t[1],H);cx.stroke();
 cx.beginPath();cx.moveTo(0,t[2]);cx.lineTo(W,t[2]);cx.moveTo(0,t[3]);cx.lineTo(W,t[3]);cx.stroke();
 cx.setLineDash([]);
}
function wrapText(text){
 var out=[],maxW=W*0.86;
 text.split('\\n').forEach(function(para){
  var words=para.split(' '),line='';
  for(var i=0;i<words.length;i++){var t=line?line+' '+words[i]:words[i];
   if(cx.measureText(t).width>maxW&&line){out.push(line);line=words[i];}else line=t;}
  out.push(line);});
 return out;}
function layerBox(l){var s=l.scale/100;
 if(l.kind==='img')return {w:l.imgW*s,h:l.imgH*s};
 if(l.kind==='rect'||l.kind==='line')return {w:l.size*s,h:(l.kind==='line'?Math.max(4,l.stroke||8):l.size*0.62)*s};
 if(l.kind==='text'){var f=(l.text||'').split('\\n'),mw=0,keep=cx?cx.font:'';
  if(cx)cx.font=fontOf(l);
  for(var i=0;i<f.length;i++)if(cx)mw=Math.max(mw,cx.measureText(f[i]).width);
  if(cx)cx.font=keep;return {w:Math.max(mw,10),h:Math.max(l.size*l.lh/100*f.length,l.size)};}
 return {w:l.size*s,h:l.size*s};}
function pathRR(x,w,h,r){r=Math.min(r,Math.abs(w)/2,Math.abs(h)/2);
 x.beginPath();x.moveTo(-w/2+r,-h/2);x.lineTo(w/2-r,-h/2);x.quadraticCurveTo(w/2,-h/2,w/2,-h/2+r);
 x.lineTo(w/2,h/2-r);x.quadraticCurveTo(w/2,h/2,w/2-r,h/2);x.lineTo(-w/2+r,h/2);
 x.quadraticCurveTo(-w/2,h/2,-w/2,h/2-r);x.lineTo(-w/2,-h/2+r);x.quadraticCurveTo(-w/2,-h/2,-w/2+r,-h/2);x.closePath();}
function pathStar(x,R){var r=R*0.42,i,a,p;
 x.beginPath();
 for(i=0;i<10;i++){a=-Math.PI/2+i*Math.PI/5;p=(i%2)?r:R;
  if(i)x.lineTo(Math.cos(a)*p,Math.sin(a)*p);else x.moveTo(Math.cos(a)*p,Math.sin(a)*p);}
 x.closePath();}
function fillOf(l,w,h){
 if(l.fill!=='g'||!cx||!cx.createLinearGradient)return l.color;
 var g=cx.createLinearGradient(-w/2,-h/2,w/2,h/2);
 g.addColorStop(0,l.color);g.addColorStop(1,l.col2||'#ffffff');return g;}
function drawLayer(l,selected){
 if(l.hidden&&!selected)return;
 if(!cx)return;
 cx.save();cx.translate(l.x,l.y);cx.rotate(l.rot*Math.PI/180);cx.globalAlpha=l.op/100;
 var sh=l.shadow||0;
 if(sh){cx.shadowColor='rgba(0,0,0,0.45)';cx.shadowBlur=sh;cx.shadowOffsetY=sh*0.3;}
 var s=l.scale/100;
 if(l.kind==='text'){
  cx.font=fontOf(l);
  try{cx.letterSpacing=(l.ls||0)+'px';}catch(e){}
  var lines=wrapText(l.text||''),lh=l.size*l.lh/100,b=layerBox(l);
  cx.textAlign=l.align==='l'?'left':(l.align==='r'?'right':'center');cx.textBaseline='middle';
  var ox=l.align==='l'?-b.w/2:(l.align==='r'?b.w/2:0);
  for(var i=0;i<lines.length;i++){var yy=(i-(lines.length-1)/2)*lh;
   if(l.stroke>0){cx.strokeStyle=l.col2||'#000000';cx.lineWidth=l.stroke;cx.strokeText(lines[i],ox,yy);}
   cx.fillStyle=fillOf(l,b.w,b.h);cx.fillText(lines[i],ox,yy);}
 }else if(l.kind==='rect'){var rw=l.size*s,rh=l.size*0.62*s;
  pathRR(cx,rw,rh,l.rad||0);cx.fillStyle=fillOf(l,rw,rh);cx.fill();
  if(l.stroke>0){cx.lineWidth=l.stroke;cx.strokeStyle=l.col2||'#000000';cx.stroke();}
 }else if(l.kind==='ellipse'){cx.fillStyle=fillOf(l,l.size*s,l.size*s);cx.beginPath();cx.arc(0,0,l.size*s/2,0,Math.PI*2);cx.fill();
  if(l.stroke>0){cx.lineWidth=l.stroke;cx.strokeStyle=l.col2;cx.stroke();}
 }else if(l.kind==='ring'){cx.strokeStyle=l.color;cx.lineWidth=Math.max(2,l.stroke||Math.round(l.size*s/18));
  cx.beginPath();cx.arc(0,0,l.size*s/2,0,Math.PI*2);cx.stroke();
 }else if(l.kind==='tri'){var R=l.size*s/2;cx.fillStyle=fillOf(l,l.size*s,l.size*s);
  cx.beginPath();cx.moveTo(0,-R);cx.lineTo(R*0.87,R*0.5);cx.lineTo(-R*0.87,R*0.5);cx.closePath();cx.fill();
  if(l.stroke>0){cx.lineWidth=l.stroke;cx.strokeStyle=l.col2;cx.stroke();}
 }else if(l.kind==='line'){var lw=l.size*s;cx.strokeStyle=l.color;cx.lineWidth=Math.max(2,l.stroke||6);
  cx.beginPath();cx.moveTo(-lw/2,0);cx.lineTo(lw/2,0);cx.stroke();
 }else if(l.kind==='star'){pathStar(cx,l.size*s/2);cx.fillStyle=fillOf(l,l.size*s,l.size*s);cx.fill();
  if(l.stroke>0){cx.lineWidth=l.stroke;cx.strokeStyle=l.col2;cx.stroke();}
 }else if(l.kind==='img'&&l.img&&l.img.complete&&l.img.naturalWidth){
  var iw=l.imgW*s,ih=l.imgH*s,ir=Math.max(0,Math.min(l.rad||0,Math.min(iw,ih)/2));
  if(l.fliph||l.flipv)cx.scale(l.fliph?-1:1,l.flipv?-1:1);
  if(ir>0){pathRR(cx,iw,ih,ir);cx.save();cx.clip();cx.drawImage(l.img,-iw/2,-ih/2,iw,ih);cx.restore();}
  else cx.drawImage(l.img,-iw/2,-ih/2,iw,ih);
  if(l.stroke>0&&ir>=0){pathRR(cx,iw,ih,ir);cx.lineWidth=l.stroke;cx.strokeStyle=l.col2||'#ffffff';cx.stroke();}}
 cx.restore();cx.globalAlpha=1;cx.setLineDash([]);cx.shadowBlur=0;cx.shadowColor='transparent';cx.shadowOffsetY=0;
 if(selected)drawHandles(l);
}
function handlePts(l){var b=layerBox(l),o=14;
 return {cs:[[-b.w/2-o,-b.h/2-o],[b.w/2+o,-b.h/2-o],[b.w/2+o,b.h/2+o],[-b.w/2-o,b.h/2+o]],
  knob:[0,-b.h/2-o*2.6],rad:(o+10)/dsD};}
function drawHandles(l){
 cx.save();cx.translate(l.x,l.y);cx.rotate(l.rot*Math.PI/180);cx.globalAlpha=1;
 cx.strokeStyle='#38bdf8';cx.lineWidth=Math.max(3,W/360);cx.setLineDash([12,9]);
 var b=layerBox(l),hp=handlePts(l),hs=Math.max(10,W/70),i;
 cx.strokeRect(-b.w/2-14,-b.h/2-14,b.w+28,b.h+28);
 cx.setLineDash([]);cx.fillStyle='#38bdf8';
 for(i=0;i<4;i++)cx.fillRect(hp.cs[i][0]-hs/2,hp.cs[i][1]-hs/2,hs,hs);
 cx.beginPath();cx.moveTo(0,-b.h/2-14);cx.lineTo(0,hp.knob[1]);cx.stroke();
 cx.beginPath();cx.arc(hp.knob[0],hp.knob[1],hs*0.62,0,Math.PI*2);cx.fill();
 cx.restore();cx.globalAlpha=1;cx.setLineDash([]);
}
function readCtl(){var l=sel>=0?layers[sel]:null;
 $('ds-txt').disabled=!l||l.kind!=='text';
 if(!l)return;
 $('ds-txt').value=l.text!==undefined?l.text:'';
 if(l.font)$('ds-font').value=l.font;
 $('ds-wt').value=String(l.weight||700);$('ds-fst').value=l.italic?'i':'n';$('ds-tal').value=l.align||'c';
 $('ds-ps').value=Math.round(l.size||0);$('ds-lh').value=Math.round(l.lh||118);$('ds-ls').value=Math.round(l.ls||0);
 if(/^#[0-9a-fA-F]{6}$/.test(l.color||''))$('ds-col').value=l.color;
 if(/^#[0-9a-fA-F]{6}$/.test(l.col2||''))$('ds-col2').value=l.col2;
 $('ds-fill').value=l.fill||'s';$('ds-st').value=Math.round(l.stroke||0);$('ds-rad').value=Math.round(l.rad||0);
 $('ds-sh').value=Math.round(l.shadow||0);$('ds-op').value=l.op;$('ds-sc').value=Math.round(l.scale);$('ds-rot').value=Math.round(l.rot);}
function select(i){sel=i;var l=i>=0?layers[i]:null;
 $('ds-sel').textContent=l?('layer '+(i+1)+' / '+layers.length+': '+l.name+(l.hidden?' (hidden)':'')):'nothing selected';
 if(l)readCtl();else $('ds-txt').disabled=true;
 panel();draw();}
function addLayer(l){push();
 l.id=++seq;l.rot=l.rot||0;l.op=l.op==null?100:l.op;l.scale=l.scale||100;l.hidden=false;
 l.color=l.color||hex($('ds-col').value);l.col2=l.col2||hex($('ds-bgb').value);
 l.fill=l.fill||'s';l.stroke=l.stroke||0;l.shadow=l.shadow||0;l.rad=l.rad||0;
 l.weight=l.weight||700;l.italic=l.italic||false;l.align=l.align||'c';l.lh=l.lh||118;l.ls=l.ls||0;
 l.font=l.font||$('ds-font').value;if(l.text===undefined)l.text='';
 l.x=l.x||Math.round(W/2);l.y=l.y||Math.round(H/2);
 layers.push(l);select(layers.length-1);stash();return l;}
function panel(){var p=$('ds-layers');if(!p)return;
 if(!layers.length){p.innerHTML='<span class="meta">no layers yet — pick a template or add text</span>';return;}
 var h='';
 for(var i=layers.length-1;i>=0;i--){var l=layers[i];
  h+='<div class="ds-lay'+(i===sel?' on':'')+'" data-i="'+i+'">'
   +'<button class="ds-eye" data-eye="'+i+'">'+(l.hidden?'\\u25ca':'\\u25cf')+'</button>'
   +'<span class="ds-nm">'+String(l.name||l.kind).replace(/</g,'&lt;')+'</span>'
   +'<span class="ds-kd">'+l.kind+(l.lock?' \u00b7 locked':'')+'</span></div>';}
 p.innerHTML=h;}
function bindClick(id,fn){var e=$(id);if(e)e.onclick=fn;}
function shape(k,name,extra){var l={kind:k,name:name,size:Math.round(W/4)};
 if(extra)for(var p in extra)l[p]=extra[p];
 return addLayer(l);}
bindClick('ds-addtext',function(){addLayer({kind:'text',name:'text',text:'Your text',size:Math.max(28,Math.round(W/13))});});
bindClick('ds-addrect',function(){shape('rect','rectangle');});
bindClick('ds-addround',function(){shape('rect','rounded rect',{rad:Math.round(W/24)});});
bindClick('ds-addcircle',function(){shape('ellipse','circle');});
bindClick('ds-addring',function(){shape('ring','ring',{stroke:Math.max(6,Math.round(W/90))});});
bindClick('ds-addtri',function(){shape('tri','triangle');});
bindClick('ds-addline',function(){shape('line','line',{size:Math.round(W*0.6),stroke:Math.max(6,Math.round(W/100))});});
bindClick('ds-addstar',function(){shape('star','star');});
var EMOFONT='"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
bindClick('ds-addsticker',function(){addLayer({kind:'text',name:'sticker',text:$('ds-emo').value||'🎉',size:Math.round(W/3),font:EMOFONT,lh:100});});
function alignTo(k){if(sel<0)return;var l=layers[sel];if(l.lock){$('ds-out').textContent='Layer is locked — unlock it before aligning.';return;}
 push();var b=layerBox(l);
 if(k==='l')l.x=Math.round(b.w/2);else if(k==='c')l.x=Math.round(W/2);else if(k==='r')l.x=Math.round(W-b.w/2);
 else if(k==='t')l.y=Math.round(b.h/2);else if(k==='m')l.y=Math.round(H/2);else if(k==='b')l.y=Math.round(H-b.h/2);
 select(sel);stash();}
['l','c','r','t','m','b'].forEach(function(a){bindClick('ds-al-'+a,function(){alignTo(a);});});
bindClick('ds-lock',function(){if(sel<0)return;var l=layers[sel];push();l.lock=!l.lock;select(sel);stash();
 $('ds-out').textContent=l.lock?('Layer "'+l.name+'" locked: it cannot be dragged, aligned, flipped or deleted until you unlock it.'):('Layer "'+l.name+'" unlocked.');});
bindClick('ds-fliph',function(){if(sel<0)return;var l=layers[sel];if(l.lock)return;push();l.fliph=!l.fliph;draw();stash();
 $('ds-out').textContent=l.fliph?'Layer flipped left-right.':'Flip left-right off.';});
bindClick('ds-flipv',function(){if(sel<0)return;var l=layers[sel];if(l.lock)return;push();l.flipv=!l.flipv;draw();stash();
 $('ds-out').textContent=l.flipv?'Layer flipped top-bottom.':'Flip top-bottom off.';});
bindClick('ds-del',function(){if(sel<0)return;if(layers[sel]&&layers[sel].lock){$('ds-out').textContent='That layer is locked — press Lock again to unlock it first.';return;}push();layers.splice(sel,1);select(Math.min(sel,layers.length-1));stash();});
bindClick('ds-dup',function(){if(sel<0)return;push();var n={},L=layers[sel];for(var k in L)n[k]=L[k];
 n.id=++seq;n.x=Math.round(L.x+W*0.05);n.y=Math.round(L.y+H*0.05);
 layers.splice(sel+1,0,n);select(sel+1);stash();});
bindClick('ds-back',function(){if(sel<=0)return;push();var L=layers[sel];layers.splice(sel,1);layers.unshift(L);select(0);stash();});
bindClick('ds-fwd',function(){if(sel<0||sel>=layers.length-1)return;push();var L=layers[sel];layers.splice(sel,1);layers.push(L);select(layers.length-1);stash();});
bindClick('ds-undo',undo);bindClick('ds-redo',redo);
bindClick('ds-clear',function(){push();layers=[];sel=-1;panel();draw();stash();$('ds-out').textContent='Canvas cleared — Undo brings the layers back.';});
var tplSel=$('ds-tpl');if(tplSel)tplSel.onchange=useTpl;
var layPanel=$('ds-layers');
if(layPanel&&layPanel.addEventListener)layPanel.addEventListener('click',function(e){
 var t=e.target||{};if(!t.getAttribute)return;
 var i=num(t.getAttribute('data-eye'),NaN);
 if(isNaN(i)&&t.closest){var row=t.closest('.ds-lay');i=num(row?row.getAttribute('data-i'):'',NaN);}
 if(isNaN(i)||!layers[i])return;
 if(t.getAttribute('data-eye')!==null){push();layers[i].hidden=!layers[i].hidden;}
 select(i);stash();});
function bindEdit(id,fn){var e=$(id);if(!e)return;
 e.oninput=function(){if(sel<0)return;fn(layers[sel]);draw();stash();};
 e.onchange=function(){if(sel<0)return;fn(layers[sel]);draw();stash();};}
bindEdit('ds-txt',function(l){if(l.kind==='text'){l.text=$('ds-txt').value;l.name=(l.text||'').slice(0,20)||'text';panel();}});
bindEdit('ds-font',function(l){if(l.font!==undefined)l.font=$('ds-font').value;});
bindEdit('ds-wt',function(l){l.weight=num($('ds-wt').value,700);});
bindEdit('ds-fst',function(l){l.italic=$('ds-fst').value==='i';});
bindEdit('ds-tal',function(l){l.align=$('ds-tal').value;});
bindEdit('ds-ps',function(l){l.size=num($('ds-ps').value,l.size);});
bindEdit('ds-lh',function(l){l.lh=Math.max(60,num($('ds-lh').value,118));});
bindEdit('ds-ls',function(l){l.ls=num($('ds-ls').value,0);});
bindEdit('ds-col',function(l){l.color=$('ds-col').value;});
bindEdit('ds-col2',function(l){l.col2=$('ds-col2').value;});
bindEdit('ds-fill',function(l){l.fill=$('ds-fill').value;});
bindEdit('ds-st',function(l){l.stroke=Math.max(0,num($('ds-st').value,0));});
bindEdit('ds-rad',function(l){l.rad=Math.max(0,num($('ds-rad').value,0));});
bindEdit('ds-sh',function(l){l.shadow=Math.max(0,num($('ds-sh').value,0));});
bindEdit('ds-op',function(l){l.op=num($('ds-op').value,100);});
bindEdit('ds-sc',function(l){l.scale=Math.max(10,Math.min(800,num($('ds-sc').value,100)));});
bindEdit('ds-rot',function(l){l.rot=num($('ds-rot').value,0);});
function canvasPos(e){var r=(cv.getBoundingClientRect&&cv.getBoundingClientRect())||{left:0,top:0,width:W,height:H};
 return {x:(e.clientX-r.left)*(W/(r.width||W)),y:(e.clientY-r.top)*(H/(r.height||H))};}
function localPt(p,l){var dx=p.x-l.x,dy=p.y-l.y,a=-l.rot*Math.PI/180;
 return {x:dx*Math.cos(a)-dy*Math.sin(a),y:dx*Math.sin(a)+dy*Math.cos(a)};}
function hitPart(p){
 if(sel>=0){var l=layers[sel],hp=handlePts(l),lp=localPt(p,l),i;
  if(dist(lp.x,lp.y,hp.knob[0],hp.knob[1])<hp.rad)return {i:sel,part:'rot'};
  for(i=0;i<4;i++)if(dist(lp.x,lp.y,hp.cs[i][0],hp.cs[i][1])<hp.rad)return {i:sel,part:'rs'};}
 for(i=layers.length-1;i>=0;i--){var L=layers[i],b=layerBox(L),q=localPt(p,L);
  if(Math.abs(q.x)<b.w/2+16&&Math.abs(q.y)<b.h/2+16)return {i:i,part:'move'};}
 return null;}
function movePt(l,p,e){
 if(chk('ds-snap')&&!e.altKey)p={x:snapV(p.x),y:snapV(p.y)};
 l.x=Math.max(0,Math.min(W,Math.round(p.x)));l.y=Math.max(0,Math.min(H,Math.round(p.y)));}
if(cv&&cv.addEventListener){
 cv.addEventListener('pointerdown',function(e){if(cv.setPointerCapture)cv.setPointerCapture(e.pointerId);
  var p=canvasPos(e),t=hitPart(p);
  if(!t){if(layers.length&&e.altKey){for(var k=layers.length-2;k>=0;k--)if(!layers[k].hidden){select(k);return;}}
   select(-1);return;}
  var i=t.i;
  if(e.altKey&&t.part==='move'){var below=-1;for(var b=i-1;b>=0;b--)if(!layers[b].hidden){below=b;break;}if(below>=0)i=below;}
  select(i);var l=layers[i];if(!l)return;
  if(l.lock){mode='';grab=null;return;}
  push();mode=t.part;
  grab={x:l.x,y:l.y,px:p.x,py:p.y,r0:dist(0,0,layerBox(l).w,layerBox(l).h)/2||1,sx:l.scale};});
 cv.addEventListener('pointermove',function(e){if(!mode||sel<0||!grab)return;var l=layers[sel],p=canvasPos(e);
  if(mode==='move'){movePt(l,{x:grab.x+(p.x-grab.px),y:grab.y+(p.y-grab.py)},e);}
  else if(mode==='rs'){var q=localPt(p,l);
   l.scale=Math.max(10,Math.min(800,Math.round(grab.sx*dist(0,0,q.x,q.y)/(grab.r0*1.35))));$('ds-sc').value=Math.round(l.scale);}
  else if(mode==='rot'){var a=deg(Math.atan2(p.y-l.y,p.x-l.x))-90;
   if(e.shiftKey)a=Math.round(a/15)*15;
   l.rot=norm(Math.round(a));$('ds-rot').value=Math.round(l.rot);}
  draw();});
 cv.addEventListener('pointerup',function(){if(mode){stash();mode='';grab=null;}});
 cv.addEventListener('wheel',function(e){if(sel<0)return;e.preventDefault();
  var l=layers[sel],d=(e.deltaMode===1?e.deltaY*16:e.deltaY)>0?-4:4;
  l.scale=Math.max(10,Math.min(800,l.scale+d));$('ds-sc').value=Math.round(l.scale);draw();stash();},{passive:false});
 cv.addEventListener('dblclick',function(){if(sel>=0&&layers[sel]&&layers[sel].kind==='text'&&layers[sel].font!==EMOFONT){var ti=$('ds-txt');if(ti&&ti.focus){ti.focus();if(ti.select)ti.select();$('ds-out').textContent='Typing mode: the text box above is focused — edit and watch the layer rename itself.';}}});}
if(typeof document!=='undefined'&&document.addEventListener)document.addEventListener('keydown',function(e){
 var t=e.target||{},tag=(t.tagName||'').toUpperCase();
 if(tag==='INPUT'||tag==='SELECT'||tag==='TEXTAREA'||tag==='CANVAS')return;
 var k=(e.key||'').toLowerCase(),m=e.ctrlKey||e.metaKey;
 if(m&&k==='z'){e.preventDefault();(e.shiftKey?redo:undo)();return;}
 if(m&&k==='y'){e.preventDefault();redo();return;}
 if(m&&k==='s'){e.preventDefault();var sd=$('ds-dl');if(sd&&sd.onclick)sd.onclick();return;}
 if(sel<0)return;var l=layers[sel],step=gsz()*(e.shiftKey?10:1);
 if(l.lock&&(k==='delete'||k==='backspace'||k==='arrowleft'||k==='arrowright'||k==='arrowup'||k==='arrowdown'||(m&&k==='d'))){e.preventDefault();return;}
 if(m&&k==='d'){e.preventDefault();var d=$('ds-dup');if(d&&d.onclick)d.onclick();return;}
 if(m&&k==='l'){e.preventDefault();push();l.hidden=!l.hidden;select(sel);stash();return;}
 if(k==='delete'||k==='backspace'){e.preventDefault();var x=$('ds-del');if(x&&x.onclick)x.onclick();return;}
 if(k==='escape'){select(-1);return;}
 if(k==='arrowleft'){e.preventDefault();push();l.x=Math.max(0,l.x-step);}
 else if(k==='arrowright'){e.preventDefault();push();l.x=Math.min(W,l.x+step);}
 else if(k==='arrowup'){e.preventDefault();push();l.y=Math.max(0,l.y-step);}
 else if(k==='arrowdown'){e.preventDefault();push();l.y=Math.min(H,l.y+step);}
 else return;
 select(sel);stash();});
function applySize(){var v=$('ds-size').value;
 if(v!=='custom'){var p=v.split('x');W=parseInt(p[0],10);H=parseInt(p[1],10);
  $('ds-w').value=W;$('ds-h').value=H;}
 var cw=num($('ds-w').value,W),ch=num($('ds-h').value,H);
 if(cw>=100&&cw<=4000&&ch>=100&&ch<=4000){W=cw;H=ch;}
 draw();}
if($('ds-size'))$('ds-size').onchange=function(){push();applySize();stash();};
if($('ds-w'))$('ds-w').oninput=applySize;
if($('ds-h'))$('ds-h').oninput=applySize;
if($('ds-bga'))$('ds-bga').oninput=draw;
if($('ds-bgb'))$('ds-bgb').oninput=draw;
if($('ds-bgs'))$('ds-bgs').onchange=function(){draw();stash();};
if($('ds-img'))$('ds-img').onchange=function(e){var f=e.target.files&&e.target.files[0];
 if(!f||typeof FileReader==='undefined')return;
 var fr=new FileReader();
 fr.onload=function(){var im=new Image();
  im.onload=function(){var s=Math.min(W*0.8/im.naturalWidth,H*0.8/im.naturalHeight,1);
   addLayer({kind:'img',name:(f.name||'image').slice(0,24),img:im,src:String(fr.result||'').slice(0,1500000),
    imgW:Math.round(im.naturalWidth*s),imgH:Math.round(im.naturalHeight*s),
    size:Math.round(im.naturalWidth*s),op:100});};
  im.src=fr.result;};
 fr.readAsDataURL(f);e.target.value='';};
function dlUrl(url,name){if(!url||typeof document==='undefined')return;
 var a=document.createElement('a');a.download=name;a.href=url;if(a.click)a.click();}
bindClick('ds-save',function(){try{dlUrl('data:application/json;charset=utf-8,'+encodeURIComponent(JSON.stringify(ser())),'tukuk-design.json');
 $('ds-out').textContent='Design file saved — images are embedded, so it reopens with every layer intact.';}catch(e){}});
$('ds-open').onchange=function(e){var f=e.target.files&&e.target.files[0];
 if(!f||typeof FileReader==='undefined')return;
 var fr=new FileReader();
 fr.onload=function(){try{var d=JSON.parse(String(fr.result)),n=loadJson(d);
   if(n<0)$('ds-out').textContent='That file is not a tukuk design document.';
   else{push();$('ds-out').textContent='Opened '+n+' layers from the design file.';autosave();}}
  catch(err){$('ds-out').textContent='Could not read that file — it must be a design file saved from this page.';}};
 fr.readAsText(f);e.target.value='';};
function hasSaved(){try{return typeof localStorage!=='undefined'&&!!localStorage.getItem('tukuk-design-v2');}catch(e){return false;}}
bindClick('ds-restore',function(){if(!hasSaved()){$('ds-out').textContent='No autosaved session in this browser yet.';return;}
 try{var n=loadJson(JSON.parse(localStorage.getItem('tukuk-design-v2')));push();
  $('ds-out').textContent='Restored '+n+' layers from the last autosaved session.';}catch(e){}});
bindClick('ds-dl',function(){if(!cx||typeof document==='undefined'||!document.createElement)return;
 var k=parseInt($('ds-scale').value,10)||1,f=$('ds-fmt').value;
 var mime=f==='jpg'?'image/jpeg':(f==='webp'?'image/webp':'image/png');
 var oc=document.createElement('canvas');oc.width=W*k;oc.height=H*k;
 var o=oc.getContext?oc.getContext('2d'):null;if(!o||!o.scale)return;
 var keepSel=sel,realCx=cx;
 sel=-1;noGuide=true;cx=o;expMode=true;expK=k;
 if(f==='jpg'){o.fillStyle='#ffffff';o.fillRect(0,0,W*k,H*k);}
 draw();
 cx=realCx;noGuide=false;expMode=false;expK=1;sel=keepSel;
 dlUrl(oc.toDataURL(mime,0.92),'tukuk-design.'+(f==='jpg'?'jpg':(f==='webp'?'webp':'png')));
 draw();});
bindClick('ds-clip',function(){if(!cx||typeof document==='undefined')return;
 if(typeof ClipboardItem==='undefined'||!navigator||!navigator.clipboard||!navigator.clipboard.write){$('ds-out').textContent='This browser cannot copy images to the clipboard — Download still works.';return;}
 var k=parseInt($('ds-scale').value,10)||1;
 var oc2=document.createElement('canvas');oc2.width=W*k;oc2.height=H*k;
 var o2=oc2.getContext?oc2.getContext('2d'):null;if(!o2||!o2.scale)return;
 var keep2=sel,real2=cx;
 sel=-1;noGuide=true;cx=o2;expMode=true;expK=k;
 draw();
 cx=real2;noGuide=false;expMode=false;expK=1;sel=keep2;draw();
 try{oc2.toBlob(function(bl){if(!bl){$('ds-out').textContent='Could not encode the PNG — try Download.';return;}
   try{navigator.clipboard.write([new ClipboardItem({'image/png':bl})]).then(function(){$('ds-out').textContent='PNG copied to the clipboard at '+k+'\u00d7 — paste it anywhere.';},function(){$('ds-out').textContent='The browser refused clipboard access — Download still works.';});}
   catch(err){$('ds-out').textContent='Clipboard unavailable in this browser — use Download.';}}
  ,'image/png');}catch(e2){$('ds-out').textContent='Clipboard unavailable — use Download instead.';}});
W=num($('ds-w').value,1080);H=num($('ds-h').value,1080);
if(hasSaved()){try{var sv=JSON.parse(localStorage.getItem('tukuk-design-v2'));
 $('ds-restore').textContent='Restore last session ('+(sv.layers||[]).length+' layers)';}catch(e){}}
addLayer({kind:'ellipse',name:'accent circle',size:Math.round(W/2),color:hex($('ds-bgb').value),op:35});
layers[0].x=Math.round(W*0.78);layers[0].y=Math.round(H*0.2);
addLayer({kind:'text',name:'headline',text:'Your headline',font:'Impact,Charcoal,sans-serif',size:Math.max(30,Math.round(W/11)),color:'#ffffff'});
layers[1].y=Math.round(H*0.5);
select(1);`,
  seo: `<h2 class="section-title">Why a plain-canvas studio beats a template portal</h2>
  <p>Every hosted design platform runs the same quiet business: your work markets the platform, the watermark is the upsell, and the file leaves your machine before you have really made it. This studio inverts all three — the pixels are composited by your browser\u2019s own canvas engine, the export is assembled locally, and closing the tab destroys the document like a whiteboard. What it deliberately lacks: the million-template warehouse, stock search, licensed font libraries and collaborative cursors — every one of them a feature of the <i>account</i> that owns your file. What it does ship instead is honest: eight starter templates composed from real layer maths, one-click alignment to every edge and centre, layer locking, image flips and emoji stickers that export as drawn, drag handles and a rotate knob, snapping to a grid with centre and rule-of-thirds guides, a 40-step undo history, autosave to your own browser, and a design file you can save as JSON and reopen later. The size presets are real too: Instagram and YouTube take exactly these dimensions because their own specs demand them.</p>
  <p class="meta">Thumbnail makers: Impact at one-eleventh of the canvas width (about 116 px on a 1280 canvas) is the size that still reads at phone preview width — anything smaller is decoration, not headline. Export at 2\u00d7 and the same text is crisp on a retina screen.</p>`,
});

// ── 38. /alat/water — daily water target ─────────────────────────────────────
TOOLKIT.push({
  slug: 'water', ic: '💧', name: 'Water Target',
  title: 'Daily Water Intake Target — Weight, Activity & Climate | Tukuk-OS',
  desc: 'A personal daily water target built from body weight, weekly exercise, climate, and pregnancy or breastfeeding — shown in litres, glasses, bottles and an hourly sipping pace. Plain arithmetic, in your browser.',
  hero: 'Water Target', sub: '35 ml per kg · exercise top-up · climate multiplier · hourly pace',
  navBlurb: 'How much water is actually enough for your weight, your training week and your climate — converted into glasses, bottles and an hourly sip pace you can follow.',
  hubBlurb: 'a daily water goal built from body weight, exercise minutes and climate, shown as litres, glasses and an hourly drinking plan',
  lead: 'The "eight glasses a day" rule is folklore, not science — the underlying guidance is roughly <b>35 ml per kg of body weight</b>, plus about <b>500 ml for every hour of exercise</b>, plus more when it is hot, dry or you are pregnant or breastfeeding. This page shows every term of the sum so you can see where your number comes from. It is guidance for healthy adults, never a prescription.',
  form: `<div class="tl-form">
  ${field('Body weight (kg)', '<input id="wa-kg" type="number" min="20" max="300" step="any" value="65">')}
  ${field('Exercise (minutes per week)', '<input id="wa-ex" type="number" min="0" max="2100" step="10" value="150">')}
  ${field('Climate / setting', '<select id="wa-cl"><option value="1" selected>temperate, mostly indoors</option><option value="1.1">hot, dry or high altitude</option><option value="1.25">hot & humid, heavy sweating</option></select>')}
  ${field('Pregnancy / breastfeeding', '<select id="wa-pg"><option value="0" selected>not applicable</option><option value="300">pregnant (+300 ml)</option><option value="700">breastfeeding (+700 ml)</option></select>')}
  ${field('Waking hours (for the pace)', '<input id="wa-hrs" type="number" min="6" max="20" step="1" value="16">')}
  <button class="tl-btn primary" id="wa-go" type="button">Fill my glass</button>
</div>
<div class="tl-res" id="wa-out">—</div>`,
  script: `
var $=function(id){return document.getElementById(id);};
function num(v,d){var n=parseFloat(v);return isNaN(n)?d:n;}
function l1(n){return (n/1000).toFixed(2)+' L';}
function render(){var kg=num($('wa-kg').value,-1),ex=num($('wa-ex').value,-1),cl=num($('wa-cl').value,1),pg=num($('wa-pg').value,0),hrs=num($('wa-hrs').value,16);
 if(kg<20||kg>300||ex<0||ex>2100||hrs<6||hrs>20){$('wa-out').innerHTML='<span class="tl-badge tl-no">check input</span> Weight 20-300 kg, exercise 0-2100 min/week, waking hours 6-20.';return;}
 var base=35*kg, exd=ex*500/(7*60), preMul=base+exd, climate=preMul*(cl-1);
 var total=preMul+climate+pg, r=Math.round(total/10)*10;
 var html='<div class="tl-big">'+l1(r)+'</div>';
 html+='<table class="tl-tab"><tbody>';
 html+='<tr><td>Base — 35 ml × '+kg+' kg</td><td>'+Math.round(base)+' ml</td></tr>';
 html+='<tr><td>Exercise — '+ex+' min/week averaged daily</td><td>+'+Math.round(exd)+' ml</td></tr>';
 html+='<tr><td>Climate ×'+cl.toFixed(2)+'</td><td>+'+Math.round(climate)+' ml</td></tr>';
 if(pg>0)html+='<tr><td>Pregnancy / breastfeeding</td><td>+'+pg+' ml</td></tr>';
 html+='<tr><td>Daily target</td><td><b>'+r+' ml ('+l1(r)+')</b></td></tr>';
 html+='<tr><td>250 ml glasses</td><td>'+(r/250).toFixed(1)+' glasses</td></tr>';
 html+='<tr><td>500 ml bottles</td><td>'+(r/500).toFixed(1)+' bottles</td></tr>';
 html+='<tr><td>Hourly pace over '+hrs+' waking hours</td><td>'+Math.round(r/hrs)+' ml every hour</td></tr>';
 html+='<tr><td>Reminder plan</td><td>8 equal stops — every '+Math.round(hrs*60/8)+' min, ~'+Math.round(r/8)+' ml each</td></tr>';
 html+='</tbody></table><p class="meta">Food already supplies roughly a fifth of daily water intake, which this deliberately generous rounding absorbs. If a doctor restricts your fluids — kidney or heart conditions — the prescription beats this page.</p>';
 $('wa-out').innerHTML=html;}
$('wa-go').onclick=render;['wa-kg','wa-ex','wa-cl','wa-pg','wa-hrs'].forEach(function(id){$(id).oninput=render;$(id).onchange=render;});render();`,
  seo: `<h2 class="section-title">Where "eight glasses a day" came from</h2>
  <p>The number traces to a 1945 U.S. Food and Nutrition Board line: about one millilitre of water per food calorie, <i>most of which is already contained in food</i>. The second half of that sentence got lost, and a hydration myth was born — one that sold bottled water beautifully. The real signals are simpler: body weight sets the baseline (roughly 35 ml/kg), sweat sets the surcharge (about 500 ml per hour of exercise and more in heat), and urine colour is the live feedback loop — pale straw means you are keeping up, dark amber means you are a glass or two behind. Thirst is a lagging indicator, which is why the hourly pace above matters more than the daily total.</p>`,
});

// ── 39. /alat/compound — compound interest & savings growth ─────────────────
TOOLKIT.push({
  slug: 'compound', ic: '🌱', name: 'Compound Interest',
  title: 'Compound Interest Calculator — Growth, Monthly Savings & Effective Rate | Tukuk-OS',
  desc: 'Compound a lump sum plus optional monthly savings at any rate and compounding frequency, with year-by-year balances, the effective annual rate and the true doubling time. Closed-form maths, in your browser.',
  hero: 'Compound Interest', sub: 'lump sum + monthly savings · yearly to daily compounding · EAR & exact doubling time',
  navBlurb: 'A lump sum and a monthly habit grown year by year with true compounding maths — including the effective annual rate banks quote differently and the exact doubling time, not just rule of 72.',
  hubBlurb: 'compound a principal plus regular savings, see the yearly table, the effective annual rate and how long money actually takes to double',
  lead: 'Interest on interest, computed the honest way: <b>A = P(1+i)ᴺ</b> for the lump sum plus the ordinary-annuity term <b>C·((1+i)ᴺ−1)/i</b> for savings deposited at each month-end. Every number below comes from those two closed forms — no simulation, no rounding drift — and the page shows the <b>effective annual rate</b> so monthly-compounded 5% is never confused with a flat 5%.',
  form: `<div class="tl-form">
  ${field('Initial amount', '<input id="ci-p" type="number" min="0" step="any" value="10000">')}
  ${field('Monthly addition', '<input id="ci-c" type="number" min="0" step="any" value="100">')}
  ${field('Annual rate (%)', '<input id="ci-r" type="number" min="0" max="100" step="any" value="5">')}
  ${field('Compounded', '<select id="ci-f"><option value="1">yearly</option><option value="2">half-yearly</option><option value="4">quarterly</option><option value="12" selected>monthly</option><option value="365">daily</option></select>')}
  ${field('Years', '<input id="ci-t" type="number" min="1" max="60" step="1" value="10">')}
  <button class="tl-btn primary" id="ci-go" type="button">Grow it</button>
</div>
<div class="tl-res" id="ci-out">—</div>`,
  script: `
var $=function(id){return document.getElementById(id);};
var FREQ={1:'yearly',2:'half-yearly',4:'quarterly',12:'monthly',365:'daily'};
function num(v,d){var n=parseFloat(v);return isNaN(n)?d:n;}
function m2(n){return n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});}
function render(){var P=num($('ci-p').value,0),C=num($('ci-c').value,0),r=num($('ci-r').value,0)/100,
 n=num($('ci-f').value,12),t=num($('ci-t').value,10);
 if(P<0||C<0||r<0||r>1||t<1||t>60){$('ci-out').innerHTML='<span class="tl-badge tl-no">check input</span> Rate between 0 and 100% / years between 1 and 60.';return;}
 var i=r/12,N=Math.round(t*12),growth=Math.pow(1+i,N);
 var lump=P*growth,ann=(i===0)?C*N:C*(growth-1)/i;
 var total=lump+ann,put=P+C*N,earn=total-put;
 var ear=i===0?0:Math.pow(1+r/n,n)-1;
 var dbl=i===0?Infinity:Math.log(2)/Math.log(1+i)/12,r72=r>0?72/(r*100):Infinity;
 var html='<div class="tl-big">'+m2(total)+'</div>';
 html+='<table class="tl-tab"><tbody>';
 html+='<tr><td>You put in</td><td>'+m2(put)+'</td></tr>';
 html+='<tr><td>Interest earned</td><td>'+m2(earn)+'</td></tr>';
 html+='<tr><td>Effective annual rate</td><td>'+(ear*100).toFixed(3)+'% (nominal '+(r*100).toFixed(2)+'% compounded '+(FREQ[n]||n)+')</td></tr>';
 html+='<tr><td>Doubling time</td><td>'+(isFinite(dbl)?dbl.toFixed(2)+' years exact':'—')+(isFinite(r72)?' · rule of 72 guesses '+r72.toFixed(2)+' (off by '+Math.abs(dbl-r72).toFixed(2)+' yr)':'')+'</td></tr>';
 html+='</tbody></table><h3 class="section-title">Year by year</h3><table class="tl-tab"><tbody><tr><td>Year</td><td>Balance</td><td>Interest so far</td></tr>';
 for(var y=1;y<=t;y++){var Ny=y*12,G=Math.pow(1+i,Ny),B=P*G+(i===0?C*Ny:C*(G-1)/i);
  html+='<tr><td>'+y+'</td><td>'+m2(B)+'</td><td>'+m2(B-P-C*Ny)+'</td></tr>';}
 html+='</tbody></table><p class="meta">Savings are treated as end-of-month deposits; taxed accounts and inflation are ignored — this is growth of the nominal number.</p>';
 $('ci-out').innerHTML=html;}
$('ci-go').onclick=render;['ci-p','ci-c','ci-r','ci-f','ci-t'].forEach(function(id){$(id).oninput=render;$(id).onchange=render;});render();`,
  seo: `<h2 class="section-title">Nominal rate, effective rate, and why banks quote both</h2>
  <p>5% "compounded monthly" is not 5% a year — it is 5%/12 credited twelve times, which comes to (1+0.05/12)¹² − 1 = 5.116% effective. Advertised savings rates that mention the frequency are quoting the nominal number; the page above always shows both, because the comparison shoppers who win are the ones who compare effective rates. The doubling time is the same honesty: <code>ln 2 / ln(1+i)</code> periods, exact — the rule of 72 is shown next to it as the mental shortcut it is.</p>`,
});

// ── 40. /alat/tax — add & remove tax (SST / GST / VAT) ──────────────────────
TOOLKIT.push({
  slug: 'tax', ic: '🧾', name: 'Tax Add & Remove',
  title: 'Tax Calculator — Add or Remove GST, SST & VAT | Tukuk-OS',
  desc: 'Take a net amount and add tax, or take a gross receipt and strip tax out of it, for any rate — with the exact net/tax split and a comparison table of common GST/VAT rates. Two multiplications, in your browser.',
  hero: 'Tax Add & Remove', sub: 'net → gross · gross → net · any rate · common-rate comparison',
  navBlurb: 'Add GST/SST/VAT to a price or strip it back out of a receipt — with the exact net and tax split, and every common world rate compared on the same number.',
  hubBlurb: 'the two directions of tax maths (adding a rate, and removing it from an inclusive price) with the precise split each time',
  lead: 'The trap this page exists for is <b>removing</b> tax: taking 6% off a tax-inclusive receipt is not the same as adding 6% and undoing it. From a gross amount the tax inside it is <b>G·t/(1+t)</b>, not <b>G·t</b>. On RM106 at 6% the tax is RM6 — subtract 6% of 106 and you get RM5.98 and a reconciliation that never balances.',
  form: `<div class="tl-form">
  ${field('Direction', '<select id="tx-mode"><option value="add" selected>Add tax to a net amount</option><option value="remove">Remove tax from a gross amount</option></select>')}
  ${field('Amount', '<input id="tx-amt" type="number" min="0" step="any" value="100">')}
  ${field('Tax rate (%)', '<input id="tx-rate" type="number" min="0" max="50" step="any" value="6">')}
  <button class="tl-btn primary" id="tx-go" type="button">Split it</button>
</div>
<div class="tl-res" id="tx-out">—</div>`,
  script: `
var $=function(id){return document.getElementById(id);};
function num(v,d){var n=parseFloat(v);return isNaN(n)?d:n;}
function m2(n){return n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});}
function split(amt,rate,mode){var t=rate/100;
 if(mode==='add')return {net:amt,tax:amt*t,gross:amt*(1+t)};
 return {net:amt/(1+t),tax:amt-amt/(1+t),gross:amt};}
function render(){var amt=num($('tx-amt').value,-1),rate=num($('tx-rate').value,-1),mode=$('tx-mode').value;
 if(amt<0||rate<0||rate>50){$('tx-out').innerHTML='<span class="tl-badge tl-no">check input</span> Amount and a rate from 0 to 50%.';return;}
 var s=split(amt,rate,mode);
 var html='<div class="tl-big">'+(mode==='add'?m2(s.gross)+' gross':m2(s.net)+' net')+'</div>';
 html+='<table class="tl-tab"><tbody>';
 html+='<tr><td>'+(mode==='add'?'Net (before tax)':'Net (excl. tax)')+'</td><td>'+m2(s.net)+'</td></tr>';
 html+='<tr><td>Tax at '+rate+'%</td><td>'+m2(s.tax)+'</td></tr>';
 html+='<tr><td>'+(mode==='add'?'Gross (with tax)':'Gross (receipt)')+'</td><td>'+m2(s.gross)+'</td></tr>';
 html+='</tbody></table><h3 class="section-title">Same number at other rates</h3><table class="tl-tab"><tbody><tr><td>Rate</td><td>Net</td><td>Tax</td><td>Gross</td></tr>';
 [5,6,8,10,12,15,18,20].forEach(function(rr){var x=split(mode==='add'?amt:s.gross,rr,mode);
  html+='<tr><td>'+rr+'%</td><td>'+m2(x.net)+'</td><td>'+m2(x.tax)+'</td><td>'+m2(x.gross)+'</td></tr>';});
 html+='</tbody></table><p class="meta">Receipt reconciliation: tax removed here is gross − net, so the three lines always add back to the printed total.</p>';
 $('tx-out').innerHTML=html;}
$('tx-go').onclick=render;['tx-amt','tx-rate','tx-mode'].forEach(function(id){$(id).oninput=render;$(id).onchange=render;});render();`,
  seo: `<h2 class="section-title">Why you cannot "take off" the rate you "put on"</h2>
  <p>Adding t% multiplies by (1+t); reversing must divide by (1+t), and division is not subtraction. On RM100: add 6% → RM106, and the tax is RM6.00. Take 6% off RM106 → RM99.64 — you have lost 36 sen per hundred and your accounts will not foot. Every GST/SST/VAT receipt you file uses the inclusive formula tax = gross × t/(1+t); that is what the "remove" direction computes, exactly, to the sen.</p>`,
});

// ── 41. /alat/breath — guided breathing pacer ────────────────────────────────
TOOLKIT.push({
  slug: 'breath', ic: '🫁', name: 'Breathing Pacer',
  title: 'Guided Breathing Pacer — Box, 4-7-8 & Coherent Breathing | Tukuk-OS',
  desc: 'A visual breathing pacer: the circle grows as you inhale, freezes on the holds, shrinks as you exhale. Coherent 5-5, box 4-4-4-4 and the calming 4-7-8 pattern, with round counter and pace summary. In your browser.',
  hero: 'Breathing Pacer', sub: 'coherent 5·5 · box 4·4·4·4 · 4-7-8 calming · visual ring, no audio',
  navBlurb: 'Follow a growing and shrinking circle through coherent, box and 4-7-8 breathing — the visual pacer that makes a one-minute calm session actually work.',
  hubBlurb: 'a visual pacer for 5-5 coherent, box 4-4-4-4 and 4-7-8 breathing with phase labels and a round countdown',
  lead: 'Breathing is the one part of your nervous system you can steer on purpose: the long exhale is the brake pedal, and every calming tradition — and modern heart-rate-variability research — converges on <b>slow exhales at roughly six rounds a minute</b>. But counting seconds is itself a stressor, so stop counting and follow the ring instead: it grows while you inhale, freezes on the holds and shrinks while you exhale. Press Start and match your breath to it.',
  form: `<div class="tl-form">
  ${field('Pattern', '<select id="bp-pat"><option value="coh" selected>Coherent 5·5 — 6 rounds/min</option><option value="box">Box 4·4·4·4 — focus</option><option value="four">4-7-8 — calming</option></select>')}
  ${field('Rounds', '<input id="bp-cy" type="number" min="1" max="40" step="1" value="6">')}
  <button class="tl-btn primary" id="bp-go" type="button">Start</button>
  <button class="tl-btn" id="bp-rs" type="button">Stop</button>
</div>
<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;padding:26px 0">
  <div id="bp-ring" style="width:150px;height:150px;border-radius:50%;display:flex;align-items:center;justify-content:center;text-align:center;font-weight:700;color:#fff;background:linear-gradient(135deg,#38bdf8,#6366f1);transform:scale(1)">Ready</div>
  <div id="bp-left" class="meta">pick a pattern and press Start</div>
</div>
<div class="tl-res" id="bp-out">—</div>`,
  script: `
var $=function(id){return document.getElementById(id);};
var LB={'in':'Breathe in','hold':'Hold','out':'Breathe out'};
var PATS={coh:{name:'Coherent 5 in, 5 out',steps:[['in',5,'up'],['out',5,'down']]},
 box:{name:'Box 4·4·4·4',steps:[['in',4,'up'],['hold',4,'max'],['out',4,'down'],['hold',4,'min']]},
 four:{name:'4-7-8',steps:[['in',4,'up'],['hold',7,'max'],['out',8,'down']]}};
var timer=null,si=0,el=0,cy=0,left=0,totalSec=0,nCy=0,len=0;
function setRing(txt,scale){$('bp-ring').style.transform='scale('+scale.toFixed(3)+')';$('bp-ring').textContent=txt;}
function stop(){if(timer){clearInterval(timer);timer=null;}$('bp-go').textContent='Start';setRing('Ready',1);$('bp-left').textContent='stopped — press Start to begin again';}
function start(){if(timer){stop();return;}
 var p=PATS[$('bp-pat').value];
 nCy=parseInt($('bp-cy').value,10)||6;
 if(nCy<1||nCy>40){$('bp-out').innerHTML='<span class="tl-badge tl-no">check input</span> Rounds from 1 to 40.';return;}
 si=0;el=0;cy=0;len=0;
 p.steps.forEach(function(s){len+=s[1];});
 totalSec=len*nCy;left=totalSec;
 $('bp-go').textContent='Stop';
 $('bp-out').innerHTML='—';
 timer=setInterval(function(){el+=0.1;left-=0.1;
  var s=p.steps[si],prog=Math.min(el/s[1],1),sc=1;
  if(s[2]==='up')sc=1+prog;else if(s[2]==='down')sc=2-prog;else if(s[2]==='max')sc=2;else sc=1;
  setRing(LB[s[0]]+' '+Math.max(0,Math.ceil(s[1]-el)),sc);
  $('bp-left').textContent=p.name+' · round '+(cy+1)+' of '+nCy+' · '+Math.max(0,Math.ceil(left))+' s left';
  if(el>=s[1]){el=0;si++;
   if(si>=p.steps.length){si=0;cy++;
    if(cy>=nCy){clearInterval(timer);timer=null;$('bp-go').textContent='Start';setRing('Done',1);
     $('bp-out').innerHTML='<div class="tl-big">'+nCy+' rounds · '+totalSec+' s</div><table class="tl-tab"><tbody><tr><td>Pattern</td><td>'+p.name+'</td></tr><tr><td>Pace</td><td>one round every '+len+' s — '+(60/len).toFixed(1)+' rounds per minute</td></tr><tr><td>How to run it</td><td>inhale through the nose, exhale through pursed lips; light-headed means ease off, not push through</td></tr></tbody></table><p class="meta">Tab switches can pause the visual — if you leave the page, press Stop and restart the round. Calming practice, not medical advice.</p>';}
   }}
 },100);}
$('bp-go').onclick=start;$('bp-rs').onclick=stop;
(function init(){$('bp-out').innerHTML='<h3 class="section-title">The three patterns at a glance</h3><table class="tl-tab"><tbody><tr><td>Pattern</td><td>Counts</td><td>One round</td><td>Rounds/min</td><td>Reach for it when</td></tr><tr><td>Coherent 5\u00b75</td><td>in 5 s, out 5 s</td><td>10 s</td><td>6.0</td><td>default — steady, calm, countless</td></tr><tr><td>Box 4\u00b74\u00b74\u00b74</td><td>in, hold, out, hold on 4</td><td>16 s</td><td>3.8</td><td>stress — the shape is easy to remember</td></tr><tr><td>4-7-8</td><td>in 4, hold 7, out 8</td><td>19 s</td><td>3.2</td><td>bedtime — the longest exhale of the three</td></tr></tbody></table><p class="meta">Pick a pattern above and press Start; the ring is the metronome.</p>';})();`,
  seo: `<h2 class="section-title">Why six rounds a minute is the magic number</h2>
  <p>Blood pressure and heart rate ride a roughly ten-second wave — five seconds up, five down. Breathe at that same rate (0.1 Hz) and your lungs, heart and baroreflex lock into the same rhythm, which is why 5-in-5-out coherent breathing measurably widens heart-rate variability, the recovery marker training apps chase. Box breathing trades the long exhale for symmetry — in, hold, out, hold on one count — easy to remember exactly when adrenaline makes counting hard, which is why pilots and emergency services train it. 4-7-8 leans the opposite way: the eight-count exhale is the longest brake-pull of the three, and the reason the pattern lives in the bedtime corner. All three work best with a pacer, because the ring costs no attention while the counting does.</p>`,
});

// ── 42. /alat/morse — morse code translator ──────────────────────────────────
TOOLKIT.push({
  slug: 'morse', ic: '📡', name: 'Morse Code',
  title: 'Morse Code Translator — Text ⇄ Morse, With Timing | Tukuk-OS',
  desc: 'Translate text to International Morse and back, with the full ITU letter, digit and punctuation table, word slashes, and dit/dah timing shown as dash counts. Optional WebAudio playback. In your browser.',
  hero: 'Morse Translator', sub: 'ITU table · A–Z 0–9 punctuation · word gaps · audio playback',
  navBlurb: 'Text to International Morse and back with the full ITU table including punctuation, word-gap slashes, and dit/dah playback generated by your browser\'s own audio oscillator.',
  hubBlurb: 'type it or dot it — encode, decode, and hear SOS at the correct 1:3:7 unit timing, no radio required',
  lead: 'The real ITU table, not the movie version: letters, digits and common punctuation, with words separated by <b>/</b> and symbols by spaces. Playback uses a single WebAudio oscillator — a dit is one unit, a dah three, intra-symbol gaps one unit, inter-symbol three, inter-word seven — so <b>SOS</b> really does come out ··· −−− ··· at 12 words per minute by default.',
  form: `<div class="tl-form">
  ${field('Direction', '<select id="mo-mode"><option value="enc" selected>text → morse</option><option value="dec">morse → text</option></select>')}
  ${field('Speed', '<select id="mo-wpm"><option value="5">5 wpm · careful</option><option value="12" selected>12 wpm · standard</option><option value="20">20 wpm · brisk</option></select>')}
  <textarea class="tl-in" id="mo-in" spellcheck="false">HELLO, WORLD!</textarea>
  <button class="tl-btn primary" id="mo-go" type="button">Translate</button>
  <button class="tl-btn" id="mo-play" type="button">▶ Play</button>
</div>
<div class="tl-res" id="mo-out">—</div>`,
  script: `
var $=function(id){return document.getElementById(id);};
var T={'A':'.-','B':'-...','C':'-.-.','D':'-..','E':'.','F':'..-.','G':'--.','H':'....','I':'..','J':'.---','K':'-.-','L':'.-..','M':'--','N':'-.','O':'---','P':'.--.','Q':'--.-','R':'.-.','S':'...','T':'-','U':'..-','V':'...-','W':'.--','X':'-..-','Y':'-.--','Z':'--..','0':'-----','1':'.----','2':'..---','3':'...--','4':'....-','5':'.....','6':'-....','7':'--...','8':'---..','9':'----.','.':'.-.-.-',',':'--..--','?':'..--..','!':'-.-.--','/':'-..-.','(':'-.--.',')':'-.--.-','&':'.-...',':':'---...',';':'-.-.-.','=':'-...-','+':'.-.-.','-':'-....-','_':'..--.-','\"':'.-..-.','$':'...-..-','@':'.--.-.'};
var RT={};for(var k in T)if(T[k])RT[T[k]]=k;
function encode(s){var out=[],bad=[];s=s.toUpperCase();
 for(var i=0;i<s.length;i++){var c=s[i];
  if(c===' '){out.push('/');continue;}
  if(T[c]!==undefined)out.push(T[c]);else bad.push(c);}
 return {morse:out.join(' '),bad:bad};}
function decode(s){var words=s.trim().split(/\\s*\\/\\s*/),out=[],bad=[];
 words.forEach(function(w){var toks=w.split(/\\s+/).filter(Boolean),buf=[];
  toks.forEach(function(t){if(RT[t]!==undefined)buf.push(RT[t]);else bad.push(t);});
  out.push(buf.join(''));});
 return {text:out.join(' '),bad:bad};}
function unitMs(){return Math.round(1200/parseInt($('mo-wpm').value,10));}
function render(){var raw=$('mo-in').value;
 var r=$('mo-mode').value==='enc'?encode(raw):decode(raw);
 var outv=$('mo-mode').value==='enc'?r.morse:r.text;
 var html='<div class="tl-pick">'+String(outv).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')+'</div>';
 var dots=0,dashes=0;(''+outv).split('').forEach(function(c){if(c==='.')dots++;if(c==='-')dashes++;});
 html+='<p class="meta">'+unitMs()+' ms per unit ('+$('mo-wpm').value+' wpm)';
 if($('mo-mode').value==='enc'&&outv!=='')html+=' · '+dots+' dits, '+dashes+' dahs — the timing is 1:3 for symbols and 1:3:7 between letter / word / gap';
 if(r.bad.length)html+=' · unmapped: '+r.bad.join(' ');
 html+='.</p>';
 $('mo-out').innerHTML=html;}
$('mo-go').onclick=render;$('mo-in').oninput=render;$('mo-mode').onchange=function(){
 var raw=$('mo-in').value;$('mo-in').value=$('mo-mode').value==='enc'?raw.toUpperCase():decode(raw).text;render();};
$('mo-wpm').onchange=render;
$('mo-play').onclick=function(){var AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;
 var ac=new AC(),u=unitMs(),t=ac.currentTime+0.05;
 var seq=($('mo-mode').value==='enc'?encode($('mo-in').value).morse:$('mo-in').value);
 var osc=ac.createOscillator(),g=ac.createGain();g.gain.value=0;osc.connect(g);g.connect(ac.destination);osc.start();
 seq.split('').forEach(function(c){var on=0;
  if(c==='.')on=u;else if(c==='-')on=3*u;
  if(on){g.gain.setValueAtTime(0.7,t);t+=on/1000;g.gain.setValueAtTime(0,t);}
  else if(c===' ')t+=3*u/1000;else if(c==='/')t+=7*u/1000;});
 osc.stop(t+0.01);setTimeout(function(){try{ac.close();}catch(e){}},(t-ac.currentTime+0.3)*1000);};
render();`,
  seo: `<h2 class="section-title">The timing is the code</h2>
  <p>Morse is a rhythm language: a dit is one unit, a dah three, the space inside a letter one, between letters three, between words seven. Get the ratios right and "ears" can copy any speed — which is why the unit length here is derived from words-per-minute the way radio operators do it: PARIS, a five-letter test word worth exactly 50 units, times the wpm. 1200 ÷ 12 wpm = 100 ms per unit. The oscillator is the browser's own; nothing is recorded, nothing is downloaded.</p>`,
});

// ── 43. /alat/phonetic — NATO alphabet ───────────────────────────────────────
TOOLKIT.push({
  slug: 'phonetic', ic: '🗣️', name: 'Phonetic Alphabet',
  title: 'NATO Phonetic Alphabet Converter — Alpha to Zulu | Tukuk-OS',
  desc: 'Spell any code, callsign or booking reference in the NATO/ICAO alphabet — Alpha Bravo Charlie — and decode word lists back to letters, digits included. A static table, in your browser.',
  hero: 'Phonetic Alphabet', sub: 'ICAO/NATO 26 words + digits · encode & decode · no audio, no account',
  navBlurb: 'Read any code out loud unambiguously: the official ICAO words Alpha through Zulu plus the digit list, both directions, with the awkward-pronunciation notes.',
  hubBlurb: 'the "can you repeat that over the phone" tool — spell it in NATO words, or paste a word chain back into letters',
  lead: 'B and D, M and N, F and S do not survive a bad line — the alphabet fix this has been standard at ICAO since 1956. Encode anything and get the word chain with separators; paste a word chain back and it decodes, tolerantly, one word at a time. The table is static and complete: including the official spellings <b>Alfa</b> and <b>Juliett</b> the standards documents actually use.',
  form: `<div class="tl-form">
  ${field('Direction', '<select id="ph-mode"><option value="enc" selected>letters → words</option><option value="dec">words → letters</option></select>')}
  <textarea class="tl-in" id="ph-in" spellcheck="false">TUKUK-2026</textarea>
  <button class="tl-btn primary" id="ph-go" type="button">Spell it</button>
</div>
<div class="tl-res" id="ph-out">—</div>`,
  script: `
var $=function(id){return document.getElementById(id);};
var W={'A':'Alpha','B':'Bravo','C':'Charlie','D':'Delta','E':'Echo','F':'Foxtrot','G':'Golf','H':'Hotel','I':'India','J':'Juliett','K':'Kilo','L':'Lima','M':'Mike','N':'November','O':'Oscar','P':'Papa','Q':'Quebec','R':'Romeo','S':'Sierra','T':'Tango','U':'Uniform','V':'Victor','W':'Whiskey','X':'X-ray','Y':'Yankee','Z':'Zulu','0':'Zero','1':'One','2':'Two','3':'Three','4':'Four','5':'Five','6':'Six','7':'Seven','8':'Eight','9':'Nine'};
var RW={};for(var k in W)RW[W[k].toLowerCase()]=k;
RW['alfa']='A';
function enc(s){var out=[],keep=[];
 for(var i=0;i<s.length;i++){var c=s[i].toUpperCase();
  if(W[c])out.push(W[c]);
  else if(c===' ')out.push('/');
  else if(keep.indexOf(s[i])<0)keep.push(s[i]);}
 return {chain:out.join(' '),keep:keep};}
function dec(s){var toks=s.toLowerCase().split(/[^a-z0-9-]+/).filter(Boolean),letters=[],bad=[];
 toks.forEach(function(t){if(t==='/'){letters.push(' ');return;}
  if(RW[t])letters.push(RW[t]);else if(t==='xray')letters.push('X');else bad.push(t);});
 return {text:letters.join(''),bad:bad};}
function render(){var raw=$('ph-in').value;
 var r=$('ph-mode').value==='enc'?enc(raw):dec(raw);
 var html='<div class="tl-pick">'+String(r.text||r.chain).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')+'</div>';
 if($('ph-mode').value==='enc'){
  html+='<p class="meta">'+raw.replace(/</g,'&lt;')+' \u2192 '+r.chain+'.';
  if(r.keep.length){var u=[];r.keep.forEach(function(c){if(u.indexOf(c)<0&&c!==' ')u.push(c);});
   if(u.length)html+=' Not in the alphabet and left as-is: '+u.join(' ')+'.';}
 }else{
  html+='<p class="meta">Decoded: '+r.text+'.';
  if(r.bad.length)html+=' Unknown words ignored: '+r.bad.join(', ')+'.';}
 html+='</p>';$('ph-out').innerHTML=html;}
$('ph-go').onclick=render;$('ph-in').oninput=render;$('ph-mode').onchange=function(){
 var raw=$('ph-in').value;$('ph-in').value=$('ph-mode').value==='enc'?raw.toUpperCase():dec(raw).text;render();};
render();`,
  seo: `<h2 class="section-title">Why Alfa, and why Juliett with two t's</h2>
  <p>The words were chosen for cross-language distinctiveness, not spelling elegance: non-native speakers confuse v/f and j/y, so the ICAO text writes <b>Alfa</b> and <b>Juliett</b> — the double-t stops French readers pronouncing it "Jew-ette", and the f stops the Spanish aitch. Numbers ride the same table (Three=Niner was proposed but rejected; the aviation "niner" lives on informally only). This page follows the published words and adds nothing.</p>`,
});


// ── 44. /alat/week — ISO week number & day of year ──────────────────────────
TOOLKIT.push({
  slug: 'week', ic: '🗓️', name: 'Week Number',
  title: 'Week Number Calculator — ISO 8601 Week, Day of Year & Reverse | Tukuk-OS',
  desc: 'Any date in its ISO week number, day of the year, days remaining and ISO date string (2026-W45-2) — or reverse: week number to the Monday–Sunday it covers. The Thursday rule, exactly, in your browser.',
  hero: 'Week Number', sub: 'ISO 8601 · W1–W53 · day-of-year · dates-to-week and week-to-dates',
  navBlurb: 'The week number the standard actually defines — first week contains a Thursday, weeks start Monday — plus day-of-year, days left, and the reverse lookup from W-number to dates.',
  hubBlurb: 'what week is it? ISO-8601 the correct way (not the +1 the spreadsheet got), day of year, and what dates a given week spans',
  lead: 'Two countries disagree about "week 1" every January, and the ISO 8601 rule settles it: <b>week 1 is the week containing the first Thursday of the year</b> (equivalently, containing January 4). Weeks run Monday to Sunday, so a 4- or 5-day January stub belongs to last year\'s final week. Both directions are on this page, from that one rule — including the Dec-28 check that catches every year-boundary case.',
  form: `<div class="tl-form">
  ${field('Direction', '<select id="wk-mode"><option value="d2w" selected>date → week & day-of-year</option><option value="w2d">year + week → dates</option></select>')}
  ${field('Date', '<input id="wk-date" type="date" value="2026-11-03">')}
  ${field('ISO year', '<input id="wk-year" type="number" min="1970" max="2099" step="1" value="2026">')}
  ${field('Week number', '<input id="wk-n" type="number" min="1" max="53" step="1" value="45">')}
  <button class="tl-btn primary" id="wk-go" type="button">Find it</button>
</div>
<div class="tl-res" id="wk-out">—</div>`,
  script: `
var $=function(id){return document.getElementById(id);};
var WD=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
function ms(y,m,d){return Date.UTC(y,m-1,d);}
function dow(t){return (new Date(t).getUTCDay()+6)%7;}
function ord(t,y){return Math.floor((t-ms(y,1,1))/864e5)+1;}
function lastW(y){var t=ms(y,12,28);return Math.floor((ord(t,y)-dow(t)-1+10)/7);}
function iso(t){var y=new Date(t).getUTCFullYear();var w=Math.floor((ord(t,y)-dow(t)-1+10)/7);
 if(w<1){y--;w=lastW(y);}else if(w>lastW(y)){y++;w=1;}return {y:y,w:w,d:dow(t)};}
 function pad(n){return (n<10?'0':'')+n;}
function fmt(t){var d=new Date(t);return d.getUTCFullYear()+'-'+pad(d.getUTCMonth()+1)+'-'+pad(d.getUTCDate());}
function render(){var mode=$('wk-mode').value;
 if(mode==='d2w'){var s=$('wk-date').value.split('-');
  if(s.length!==3){$('wk-out').innerHTML='<span class="tl-badge tl-no">check input</span> Pick a date.';return;}
  var t=ms(+s[0],+s[1],+s[2]),y=+s[0];
  if(isNaN(t)||s[0]<1970||s[0]>2099){$('wk-out').innerHTML='<span class="tl-badge tl-no">check input</span> Years 1970 to 2099.';return;}
  var i=iso(t),leap=(y%4===0&&y%100!==0)||y%400===0,oy=ord(t,y),tot=leap?366:365;
  var html='<div class="tl-big">W'+i.w+' of '+i.y+'</div><table class="tl-tab"><tbody>';
  html+='<tr><td>ISO date string</td><td>'+i.y+'-W'+pad(i.w)+'-'+(i.d+1)+'</td></tr>';
  html+='<tr><td>Week spans</td><td>'+fmt(t-i.d*864e5)+' to '+fmt(t+(6-i.d)*864e5)+'</td></tr>';
  html+='<tr><td>Weekday</td><td>'+WD[i.d]+'</td></tr>';
  html+='<tr><td>Day of year</td><td>'+oy+' of '+tot+'</td></tr>';
  html+='<tr><td>Days remaining</td><td>'+(tot-oy)+' · '+Math.floor((tot-oy)/7)+' whole weeks left in '+y+'</td></tr>';
  html+='<tr><td>Weeks in '+i.y+'</td><td>'+lastW(i.y)+'</td></tr></tbody></table>';
  html+='<p class="meta">If the calendar year and ISO year differ (early January), the ISO year is printed first — that is the Dec-28 rule doing its job.</p>';
  $('wk-out').innerHTML=html;
 }else{var wy=parseInt($('wk-year').value,10),wn=parseInt($('wk-n').value,10);
  if(!(wy>=1970&&wy<=2099)||!(wn>=1&&wn<=lastW(wy))){
   $('wk-out').innerHTML='<span class="tl-badge tl-no">check input</span> '+wy+' has weeks 1 to '+(wy>=1970&&wy<=2099?lastW(wy):53)+'.';return;}
  var j4=ms(wy,1,4),w1=j4-dow(j4)*864e5,mon=w1+(wn-1)*7*864e5;
  var html2='<div class="tl-big">'+wy+'-W'+pad(wn)+'</div><table class="tl-tab"><tbody>';
  html2+='<tr><td>Monday</td><td>'+fmt(mon)+'</td></tr>';
  ['Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].forEach(function(nm,ix){
   html2+='<tr><td>'+nm+'</td><td>'+fmt(mon+(ix+1)*864e5)+'</td></tr>';});
  html2+='</tbody></table><p class="meta">Week 1 always contains January 4 — that is the fastest way to check the Monday above by hand.</p>';
  $('wk-out').innerHTML=html2;}}
$('wk-go').onclick=render;['wk-date','wk-year','wk-n'].forEach(function(id){$(id).oninput=render;});
$('wk-mode').onchange=render;render();`,
  seo: `<h2 class="section-title">The spreadsheet that starts the year on week 2</h2>
  <p>US convention counts the week containing January 1 as week 1, so its numbers trail ISO by one for years that start in November, December or January — 2026 starts on a Thursday, so its first four days are already ISO week 1 and the difference shows up the very next Monday. This page never counts from January 1: it computes floor((ordinal − weekday + 10) ÷ 7), the direct form of the Thursday rule, and cross-checks boundaries against December 28, which is provably always in the last ISO week of its year.</p>`,
});

// ── 45. /alat/markdown — markdown to html ────────────────────────────────────
TOOLKIT.push({
  slug: 'markdown', ic: '📝', name: 'Markdown to HTML',
  title: 'Markdown to HTML Converter — Safe Subset, No Uploads | Tukuk-OS',
  desc: 'Convert Markdown to clean, escaped HTML — headings, bold, italic, code, links, lists and quotes — with the output shown side by side. Everything happens in your browser; raw angle brackets can never sneak through.',
  hero: 'Markdown → HTML', sub: 'headings · bold · italic · code · links · lists · quotes · escaped first',
  navBlurb: 'A Markdown-to-HTML converter that escapes angle brackets before it formats, so no script tag ever survives the trip — paste, copy, done, nothing uploaded.',
  hubBlurb: 'quick md → html with a deliberately small, fully predictable subset of CommonMark — safe by escaping first, not by filtering later',
  lead: 'The order matters: every <code>&lt;</code>, <code>&amp;</code> and <code>&gt;</code> is escaped <b>before</b> any formatting is applied, so the only HTML tags in the output are the ones this page emits. Supported: <code>#</code>–<code>######</code> headings, <b>**bold**</b>, <i>*italic*</i> and <i>_italic_</i>, <code>&#96;code&#96;</code>, <code>[text](url)</code> links (http, https, mailto and site-relative only), <code>- </code> and <code>1. </code> lists, <code>&gt; </code> quotes, and <code>---</code> rules.',
  form: `<div class="tl-form">
  <textarea class="tl-in" id="mk-in" rows="10" spellcheck="false"># Hello tukuk

Some **bold**, some *italic*, and some &#96;code&#96;.

- first point
- second point

1. numbered one
2. numbered two

> A quotation, with a [link](https://tukuk.org).

---</textarea>
  <button class="tl-btn primary" id="mk-go" type="button">Convert</button>
  <button class="tl-btn" id="mk-copy" type="button">Copy HTML</button>
</div>
<div class="tl-res" id="mk-prev">—</div>
<div class="tl-res" id="mk-out">—</div>`,
  script: `
var $=function(id){return document.getElementById(id);};
var TICK=String.fromCharCode(96);
function esc(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function inline(s){var e=esc(s);
 e=e.replace(new RegExp(TICK+'([^'+TICK+']+?)'+TICK,'g'),function(m,c){return '<code>'+c+'</code>';});
 e=e.replace(/\\*\\*([^*]+?)\\*\\*/g,'<strong>$1</strong>');
 e=e.replace(/(^|[^*])\\*([^*\\s][^*]*?)\\*/g,'$1<em>$2</em>');
 e=e.replace(/(^|[\\s(_])_([^_\\s][^_]*?)_/g,'$1<em>$2</em>');
 e=e.replace(/\\[([^\\]]+?)\\]\\(([^)\\s]+?)\\)/g,function(m,txt,url){
  var oku=/^(https?:|mailto:|\\/)/i.test(url);
  return oku?'<a href="'+url+'">'+txt+'</a>':m;});
 return e;}
function conv(src){var lines=src.replace(/\\r/g,'').split('\\n'),out=[],i=0;
 while(i<lines.length){var L=lines[i];
  if(/^\\s*$/.test(L)){i++;continue;}
  var h=L.match(/^(#{1,6})\\s+(.*)$/);
  if(h){out.push('<h'+h[1].length+'>'+inline(h[2])+'</h'+h[1].length+'>');i++;continue;}
  if(/^(-{3,}|\\*{3,})\\s*$/.test(L)){out.push('<hr>');i++;continue;}
  if(/^>\\s?/.test(L)){var q=[];while(i<lines.length&&/^>\\s?/.test(lines[i])){q.push(inline(lines[i].replace(/^>\\s?/,'')));i++;}
   out.push('<blockquote><p>'+q.join(' ')+'</p></blockquote>');continue;}
  if(/^\\s*[-*]\\s+/.test(L)){var ul=[];while(i<lines.length&&/^\\s*[-*]\\s+/.test(lines[i])){ul.push('<li>'+inline(lines[i].replace(/^\\s*[-*]\\s+/,''))+'</li>');i++;}
   out.push('<ul>'+ul.join('')+'</ul>');continue;}
  if(/^\\s*\\d+\\.\\s+/.test(L)){var ol=[];while(i<lines.length&&/^\\s*\\d+\\.\\s+/.test(lines[i])){ol.push('<li>'+inline(lines[i].replace(/^\\s*\\d+\\.\\s+/,''))+'</li>');i++;}
   out.push('<ol>'+ol.join('')+'</ol>');continue;}
  var par=[];while(i<lines.length&&!/^\\s*$/.test(lines[i])&&!/^(#{1,6}\\s|>|\\s*[-*]\\s|\\s*\\d+\\.\\s|-{3,}\\s*$|\\*{3,}\\s*$)/.test(lines[i])){par.push(lines[i]);i++;}
  if(par.length)out.push('<p>'+inline(par.join(' '))+'</p>');else i++;}
 return out.join('\\n');}
function render(){var html=conv($('mk-in').value);
 $('mk-prev').innerHTML=html;
 $('mk-out').innerHTML='<pre class="tl-pick">'+esc(html)+'</pre>';
 $('mk-copy').onclick=function(){if(navigator.clipboard&&navigator.clipboard.writeText)
  navigator.clipboard.writeText(html).catch(function(){});};}
render();$('mk-in').oninput=render;$('mk-go').onclick=render;`,
  seo: `<h2 class="section-title">Escaping first is the whole security story</h2>
  <p>Most online Markdown converters inject raw HTML from the input — which is how a paste into a comment box becomes a session-stealing script. Here the reverse is true: nothing that is not an entity or one of the dozen tags above can appear in the output, and links are checked against http/https/mailto/relative so a <code>javascript:</code> href dies on the spot. That also means the converter is boring on purpose: tables, footnotes and HTML blocks belong to bigger renderers, not to a paste box.</p>`,
});

// ── 46. /alat/case — programmer case converter ───────────────────────────────
TOOLKIT.push({
  slug: 'case', ic: '🔤', name: 'Case Converter',
  title: 'Case Converter — camelCase, snake_case, kebab & Pascal | Tukuk-OS',
  desc: 'One identifier in, all nine programmer conventions out: camelCase, PascalCase, snake_case, SCREAMING_SNAKE, kebab-case, Title Case, Sentence case, dot.case and path/case. Word-boundary aware, in your browser.',
  hero: 'Case Converter', sub: 'camel · Pascal · snake · SCREAMING · kebab · Title · dot · path · sentence',
  navBlurb: 'Paste any identifier — getUserID, http-request, API_KEY_2 — and get all nine naming conventions from one tokenisation, camelCase humps included.',
  hubBlurb: 'the copy-from-stackoverflow formatting tool: every dev naming style at once, with the acronym-aware split shown',
  lead: 'The hard half of re-casing is splitting: this page breaks on spaces and punctuation, on lowercase-to-uppercase humps (<code>requestId</code> → request + Id) and on acronym runs (<code>HTTPServer</code> → HTTP + Server) — the same two regexes ESLint and Prettier plugins use. Once the word list is right, every convention is just a different join.',
  form: `<div class="tl-form">
  <textarea class="tl-in" id="cs-in" rows="3" spellcheck="false">getUserID http-server API_KEY_2 the quick_brownFox</textarea>
  <button class="tl-btn primary" id="cs-go" type="button">Convert</button>
</div>
<div class="tl-res" id="cs-out">—</div>`,
  script: `
var $=function(id){return document.getElementById(id);};
function words(s){return s
 .replace(/([a-z0-9])([A-Z])/g,'$1 $2')
 .replace(/([A-Z]+)([A-Z][a-z])/g,'$1 $2')
 .split(/[^A-Za-z0-9]+/).filter(Boolean);}
function cap(w){return w.charAt(0).toUpperCase()+w.slice(1);}
function render(){var ws=words($('cs-in').value);
 if(!ws.length){$('cs-out').innerHTML='<span class="tl-badge tl-no">check input</span> Type an identifier — letters or digits.';return;}
 var lw=ws.map(function(w){return /^[0-9]+$/.test(w)?w:w.toLowerCase();}),uw=lw.map(function(w){return w.toUpperCase();});
 function rows(){return [
  ['camelCase',lw[0]+lw.slice(1).map(cap).join('')],
  ['PascalCase',lw.map(cap).join('')],
  ['snake_case',lw.join('_')],
  ['SCREAMING_SNAKE',uw.join('_')],
  ['kebab-case',lw.join('-')],
  ['Title Case',lw.map(cap).join(' ')],
  ['Sentence case',lw.join(' ').replace(/^[a-z]/,function(c){return c.toUpperCase();})],
  ['dot.case',lw.join('.')],
  ['path/case',lw.join('/')]];
 }
 var html='<div class="tl-big">'+ws.length+' word'+(ws.length===1?'':'s')+': '+ws.map(function(w){return esc(w);}).join(' · ')+'</div>';
 html+='<table class="tl-tab"><tbody>';
 rows().forEach(function(r){html+='<tr><td>'+r[0]+'</td><td>'+esc(r[1])+'</td></tr>';});
 html+='</tbody></table><p class="meta">Digits stay their own word (KEY_2 → key · 2), which is why SCREAMING and snake keep the underscore before them.</p>';
 $('cs-out').innerHTML=html;}
function esc(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
$('cs-go').onclick=render;$('cs-in').oninput=render;render();`,
  seo: `<h2 class="section-title">Why HTTPServer and requestId split differently</h2>
  <p>A hump is a lowercase letter followed by an uppercase one — that is the <code>(lower)(UPPER)</code> boundary. An acronym is an uppercase run followed by a capital-and-lowercase pair, so the last capital belongs to the next word: <code>HTTPServer</code> splits before "Server", <code>getUserID</code> splits after "get" and leaves "UserID", which a second pass on the acronym rule does not break further because "ID" has no lowercase tail. Every convention in the table is then just lowercasing, capitalising and choosing a separator — dot, slash, underscore, hyphen or space.</p>`,
});

// ── 47. /alat/coords — coordinate distance & bearing ─────────────────────────
TOOLKIT.push({
  slug: 'coords', ic: '📍', name: 'Coordinate Distance',
  title: 'Distance Between Two Coordinates — Haversine km, Miles & Bearing | Tukuk-OS',
  desc: 'Paste two latitude/longitude pairs and get the great-circle distance in km, miles and nautical miles plus the initial bearing — the haversine formula, shown in full, in your browser.',
  hero: 'Coordinate Distance', sub: 'haversine · great-circle · km / mi / nmi · initial bearing · swap',
  navBlurb: 'How far is it really between two lat/lon dots: haversine great-circle distance in km, miles and nautical miles, with the compass bearing you would leave on.',
  hubBlurb: 'two map pins in, straight-line-over-the-globe distance out — with the rhumb-line bearing and a map of why it is not the driving distance',
  lead: 'Flat maps lie about distance; the shortest path between two points on a sphere is the arc of the great circle through them. This page computes that arc with the <b>haversine formula</b> on the mean Earth radius <b>6,371.0088 km</b> — accurate to a few tenths of a percent everywhere (the true ellipsoid differs by up to 0.5% — stated, not hidden) — plus the <b>initial bearing</b>, the compass heading at departure, which is not the heading you arrive on.',
  form: `<div class="tl-form">
  ${field('Latitude 1', '<input id="hv-a1" type="number" step="any" min="-90" max="90" value="3.1390">')}
  ${field('Longitude 1', '<input id="hv-o1" type="number" step="any" min="-180" max="180" value="101.6869">')}
  ${field('Latitude 2', '<input id="hv-a2" type="number" step="any" min="-90" max="90" value="1.3521">')}
  ${field('Longitude 2', '<input id="hv-o2" type="number" step="any" min="-180" max="180" value="103.8198">')}
  <button class="tl-btn primary" id="hv-go" type="button">Measure</button>
  <button class="tl-btn" id="hv-swap" type="button">Swap ⇅</button>
</div>
<div class="tl-res" id="hv-out">—</div>`,
  script: `
var $=function(id){return document.getElementById(id);};
var R=6371.0088,D=Math.PI/180;
var CAR=['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
function num(id){var v=parseFloat($(id).value);return isNaN(v)?null:v;}
function render(){var a1=num('hv-a1'),o1=num('hv-o1'),a2=num('hv-a2'),o2=num('hv-o2');
 if(a1===null||o1===null||a2===null||o2===null||Math.abs(a1)>90||Math.abs(a2)>90||Math.abs(o1)>180||Math.abs(o2)>180){
  $('hv-out').innerHTML='<span class="tl-badge tl-no">check input</span> Latitude −90…90, longitude −180…180, all four filled.';return;}
 var p1=a1*D,p2=a2*D,dp=p2-p1,dl=(o2-o1)*D;
 var h=Math.sin(dp/2)*Math.sin(dp/2)+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)*Math.sin(dl/2);
 var c=2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h)),km=R*c;
 var y=Math.sin(dl)*Math.cos(p2),x=Math.cos(p1)*Math.sin(p2)-Math.sin(p1)*Math.cos(p2)*Math.cos(dl);
 var br=(Math.atan2(y,x)/D+360)%360;
 var same=km<0.0005;
 var html='<div class="tl-big">'+km.toFixed(1)+' km</div>';
 html+='<table class="tl-tab"><tbody>';
 html+='<tr><td>Miles</td><td>'+(km/1.609344).toFixed(1)+' mi</td></tr>';
 html+='<tr><td>Nautical miles</td><td>'+(km/1.852).toFixed(1)+' nmi — the definition: 1 nmi = 1 minute of arc</td></tr>';
 html+='<tr><td>Initial bearing</td><td>'+br.toFixed(1)+'° '+CAR[Math.round(br/22.5)%16]+(same?'':' (reciprocal arrival heading '+(((br+180)%360).toFixed(1))+'°)')+'</td></tr>';
 html+='<tr><td>Antipodes</td><td>'+(km>20015?'beyond half the planet — "as the crow flies" points the other way':'fine, less than a hemisphere')+'</td></tr>';
 html+='</tbody></table><h3 class="section-title">The formula, in one line</h3><p>a = sin²(Δφ/2) + cos φ₁ · cos φ₂ · sin²(Δλ/2), d = 2R·atan2(√a, √(1−a))</p>';
 html+='<p class="meta">Driving distance is typically 1.2–1.8× this; the great circle is what a plane, a ship or a radio beam uses.</p>';
 $('hv-out').innerHTML=html;}
$('hv-go').onclick=render;$('hv-swap').onclick=function(){
 var t;$('hv-a1').value=(t=$('hv-a1').value,$('hv-a1').value=$('hv-a2').value,$('hv-a2').value=t);
 $('hv-o1').value=(t=$('hv-o1').value,$('hv-o1').value=$('hv-o2').value,$('hv-o2').value=t);render();};
['hv-a1','hv-o1','hv-a2','hv-o2'].forEach(function(id){$(id).oninput=render;});render();`,
  seo: `<h2 class="section-title">Haversine instead of the spherical law of cosines</h2>
  <p>Both give the same arc; the haversine form is used because it stays numerically stable for short hops — the cosine version loses precision to floating-point rounding when the two points are close (the famous "1-metre error at 5 km"). The radius 6,371.0088 km is the IUGG mean: equatorial points are ~0.3% further from the centre than polar ones, so a WGS-84 ellipsoid calculator (Vincenty) will differ from this by up to about 0.5% — acceptable for curiosity, not for surveying.</p>`,
});


// ── 48. /alat/month-grid — month calendar grid generator ─────────────────────────
TOOLKIT.push({
  slug: 'month-grid', ic: '🗓️', name: 'Calendar Grid',
  title: 'Month Calendar Generator — Printable Grid with Week Numbers | Tukuk-OS',
  desc: 'Any month, any year, Monday or Sunday start — a clean printable grid with ISO week numbers down the side, built from plain date arithmetic in your browser. No trackers, no sign-up, no sidebar.',
  hero: 'Calendar Grid', sub: 'any month 1900–2200 · Mon/Sun start · ISO week numbers · print-ready',
  navBlurb: 'A printable month grid for any month in 240 years — Monday or Sunday start, ISO week numbers down the side, generated from calendar arithmetic and nothing else.',
  hubBlurb: 'plan-a-month calendar with real week numbers, the right length of every month and leap years handled by the 4/100/400 rule',
  lead: 'The whole grid comes from three pieces of honest arithmetic: the 4-or-100-or-400 leap rule for February, the day-of-week of the 1st from UTC midnights, and the ISO week number of each row taken from the Thursday that row contains — which is why a row can show W1 in December or W53 in January and be correct.',
  form: `<div class="tl-form">
  ${field('Month', '<select id="ca-m"><option value="1">January</option><option value="2">February</option><option value="3">March</option><option value="4">April</option><option value="5">May</option><option value="6">June</option><option value="7">July</option><option value="8">August</option><option value="9">September</option><option value="10">October</option><option value="11" selected>November</option><option value="12">December</option></select>')}
  ${field('Year', '<input id="ca-y" type="number" min="1900" max="2200" step="1" value="2026">')}
  ${field('Week starts', '<select id="ca-s"><option value="1" selected>Monday</option><option value="0">Sunday</option></select>')}
  <button class="tl-btn primary" id="ca-go" type="button">Draw it</button>
  <button class="tl-btn" id="ca-print" type="button">🖨 Print</button>
</div>
<div class="tl-res" id="ca-out">—</div>`,
  css: `
.ca-grid{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}
.ca-grid th,.ca-grid td{border:1px solid #d3365b22;padding:7px 6px;text-align:center;font-size:15px}
.ca-grid th{background:#f6eef1;font-weight:700}
.ca-grid .ca-w{background:#faf7f8;color:#8a8f98;font-size:12px;font-weight:700}
.ca-grid .ca-d{color:#c8ccd2}
@media print{.ca-grid th,.ca-grid td{border-color:#999}}`,
  script: `
var $=function(id){return document.getElementById(id);};
var MN=['January','February','March','April','May','June','July','August','September','October','November','December'];
var WD=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
function ms(y,m,d){return Date.UTC(y,m-1,d);}
function dowM(t){return (new Date(t).getUTCDay()+6)%7;}
function dim(y,m){return new Date(Date.UTC(y,m,0)).getUTCDate();}
function thuWeek(t){var d=new Date(t),y=d.getUTCFullYear();
 var ord=Math.floor((t-ms(y,1,1))/864e5)+1;return Math.floor((ord+6)/7);}
function render(){var y=parseInt($('ca-y').value,10),m=parseInt($('ca-m').value,10),st=parseInt($('ca-s').value,10);
 if(!(y>=1900&&y<=2200)){ $('ca-out').innerHTML='<span class="tl-badge tl-no">check input</span> Years 1900 to 2200.';return;}
 var first=ms(y,m,1),days=dim(y,m),shift=(dowM(first)+(st===0?1:0))%7;
 var heads=st===0?['Sun','Mon','Tue','Wed','Thu','Fri','Sat']:['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
 var html='<div class="tl-big">'+MN[m-1]+' '+y+'</div>';
 html+='<table class="ca-grid"><thead><tr><th class="ca-w">W</th>';
 heads.forEach(function(h){html+='<th>'+h+'</th>';});html+='</tr></thead><tbody>';
 var cell=1-shift;
 while(cell<=days){html+='<tr>';
 var startT=ms(y,m,cell),thuT=startT+(st===0?4:3)*864e5;
 html+='<td class="ca-w">W'+thuWeek(thuT)+'</td>';
 for(var k=0;k<7;k++){var dnum=cell+k;
  if(dnum<1||dnum>days)html+='<td class="ca-d"></td>';
  else html+='<td>'+dnum+'</td>';}
 html+='</tr>';cell+=7;}
 html+='</tbody></table>';
 var leap=(y%4===0&&y%100!==0)||y%400===0;
 html+='<p class="meta">'+MN[m-1]+' '+y+' has '+days+' days and starts on a '+WD[dowM(first)]+
 (m===2?' — '+y+' is '+(leap?'a leap year (Feb has 29)':'not a leap year (Feb has 28)'):'')+
 '. W-numbers are ISO 8601, taken from the Thursday each row contains.</p>';
 $('ca-out').innerHTML=html;}
$('ca-go').onclick=render;$('ca-print').onclick=function(){if(window.print)window.print();};
$('ca-m').onchange=render;$('ca-y').oninput=render;$('ca-s').onchange=render;render();`,
  seo: `<h2 class="section-title">Why the week number belongs to the Thursday</h2>
  <p>A calendar row straddles months, and in January it can straddle years — so asking "what week is this row" needs one unambiguous member of it. ISO 8601 effectively answers with the Thursday: the Thursday of a row is never in a different ISO year than the majority of its days (Monday through Thursday of a new year guarantee the switch), which makes it the safest single reference day. November 2026 is a good test case: the first cell, Sunday Nov 1 on a Monday-start grid, still belongs to W44 — and the grid above shows exactly that.</p>`,
});

// ── 49. /alat/typing — typing speed test ─────────────────────────────────────
TOOLKIT.push({
  slug: 'typing', ic: '⌨️', name: 'Typing Speed Test',
  title: 'Typing Speed Test — Words Per Minute & Accuracy, No Sign-Up | Tukuk-OS',
  desc: 'A one-minute typing test against 60 common English words: live WPM, raw WPM and error rate, scored with the standard five-characters-per-word rule. Timed entirely in your browser.',
  hero: 'Typing Speed Test', sub: '60 s · WPM · raw WPM · accuracy · the honest 5-char word rule',
  navBlurb: 'Sixty seconds, sixty common words, live scoring by the standard typing-test convention — 5 keystrokes = 1 word, errors count against you, nothing leaves the page.',
  hubBlurb: 'measure your real typing speed the way every benchmark defines it, with per-keystroke feedback and an accuracy score',
  lead: 'The scoreboard uses the conventions actual typing benchmarks defined: a word is <b>five correct characters</b> (the length of average English words on a typewriter counter), <b>net WPM</b> subtracts errors, <b>raw WPM</b> does not, and accuracy is correct ÷ total keystrokes. Words come from a fixed list of common English words — 60 sampled per run, shuffled in the browser, never fetched.',
  form: `<div class="tl-form">
  <div class="tl-pick" id="ty-words">Press Start — 60 common words, 60 seconds.</div>
  <input id="ty-type" type="text" placeholder="type the words here, space to advance…" autocomplete="off" autocapitalize="off" spellcheck="false" disabled>
  ${field('Seconds', '<select id="ty-dur"><option value="30">30</option><option value="60" selected>60</option><option value="120">120</option></select>')}
  <button class="tl-btn primary" id="ty-start" type="button">Start</button>
</div>
<div class="tl-res" id="ty-out">—</div>`,
  css: `
.ty-w{display:inline-block;padding:3px 8px;margin:2px;border-radius:8px;background:#f4eef0;color:#3a3f46;font-family:ui-monospace,monospace}
.ty-cur{outline:2px solid #38bdf8}
.ty-bad{background:#fbdce4;color:#a3133f}
.ty-done{background:#e5f6e9;color:#1c6b34}`,
  script: `
var $=function(id){return document.getElementById(id);};
var W=['the','and','that','with','have','this','from','they','will','what','when','your','says','there','their','which','about','would','these','other','into','could','time','given','many','some','most','only','over','such','then','make','like','being','just','know','take','people','year','good','each','see','number','way','water','part','after','place','case','week','where','never','bring','while','learn','point','order','value','world','build','change','follow','begin','close','count','group','issue','level','move','music','need','play','quiet','range','right','shape','study','table','usual','voice','watch','write'];
var pool=[],wi=0,typed=0,correct=0,errors=0,left=60,tick=null,started=0;
function drawWords(){var h='';
 for(var i=0;i<pool.length;i++){h+='<span class="ty-w'+(i===wi?' ty-cur':(i<wi?(pool[i].done?' ty-done':' ty-bad'):''))+'" data-i="'+i+'">'+pool[i].w+'</span> ';}
 $('ty-words').innerHTML=h;}
function shuffle(a){for(var j=a.length-1;j>0;j--){var k=Math.floor(Math.random()*(j+1)),t=a[j];a[j]=a[k];a[k]=t;}return a;}
function finish(){if(tick)clearInterval(tick);tick=null;$('ty-type').disabled=true;
 var mins=(Date.now()-started)/60000;if(mins<=0)mins=1/600;
 var net=(correct/5)/mins,raw=(typed/5)/mins,acc=typed>0?100*correct/typed:0;
 $('ty-out').innerHTML='<div class="tl-big">'+Math.round(net)+' WPM net</div>'+
 '<table class="tl-tab"><tbody>'+
 '<tr><td>Raw speed</td><td>'+Math.round(raw)+' WPM (errors included in the count)</td></tr>'+
 '<tr><td>Accuracy</td><td>'+acc.toFixed(1)+'% — '+correct+' correct of '+typed+' keystrokes</td></tr>'+
 '<tr><td>Errors</td><td>'+errors+' word'+(errors===1?'':'s')+' failed</td></tr>'+
 '</tbody></table><p class="meta">Net WPM = correct characters ÷ 5 ÷ minutes — the same arithmetic as the classic typewriter counters; a 120 WPM claim measured as raw is roughly 100 net.</p>';
 $('ty-start').textContent='Run again';}
function advance(){var inp=$('ty-type'),want=pool[wi].w,got=inp.value.trim();
 if(!got)return;
 inp.value='';
 if(got===want){pool[wi].done=true;correct+=want.length+1;}
 else{pool[wi].done=false;errors++;
  for(var i2=0;i2<Math.min(want.length,got.length);i2++)if(want[i2]===got[i2])correct++;
  typed+=Math.max(got.length,want.length);}
 wi++;drawWords();
 if(wi>=pool.length)finish();}
$('ty-type').onkeydown=function(e){if(e.key===' '){e.preventDefault();advance();}};
$('ty-type').oninput=function(){var inp=$('ty-type'),want=pool[wi]?pool[wi].w:'';
 typed++;
 if(want.indexOf(inp.value)!==0){inp.classList.add('ty-bad');}
 else inp.classList.remove('ty-bad');};
$('ty-start').onclick=function(){pool=shuffle(W.slice()).slice(0,60).map(function(w){return {w:w,done:false};});
 wi=0;typed=0;correct=0;errors=0;left=parseInt($('ty-dur').value,10);started=Date.now();
 drawWords();$('ty-type').disabled=false;$('ty-type').value='';$('ty-type').focus();
 $('ty-out').innerHTML='<span class="tl-badge tl-ok">go</span> '+left+' seconds — type each word and press space.';
 if(tick)clearInterval(tick);
 tick=setInterval(function(){left--;
  $('ty-out').innerHTML='<span class="tl-badge tl-ok">'+left+' s left</span> Keep going.';
  if(left<=0)finish();},1000);};
(function init(){pool=W.slice(0,12).map(function(w){return {w:w,done:false};});wi=-1;drawWords();
 $('ty-words').innerHTML+=' <span class="meta">preview of the word bank — Start shuffles a fresh 60.</span>';})();`,
  seo: `<h2 class="section-title">Where "words per minute" comes from</h2>
  <p>Counting words is ambiguous ("ox" vs "antidisestablishmentarianism"), so since the typewriter era speed has been measured in <b>five-character words</b> — the average length of English text as a constant. Your net score is correct keystrokes (including the spaces that complete each word) divided by five, divided by minutes; raw speed counts every keystroke you made. That single convention is what makes 60 WPM here comparable to 60 WPM anywhere else.</p>`,
});


// ── 50. /alat/gpa — GPA & CGPA calculator ────────────────────────────────────
TOOLKIT.push({
  slug: 'gpa', ic: '🎓', name: 'GPA Calculator',
  title: 'GPA & CGPA Calculator — Credits-Weighted, With the Catch-Up Sum | Tukuk-OS',
  desc: 'Grade-point average from any list of courses with credit hours, the per-course working shown, degree-class band, and the credits of straight-A study needed to reach a target CGPA. In your browser.',
  hero: 'GPA Calculator', sub: 'credits × grade points · 4.00 scale · degree class · catch-up maths',
  navBlurb: 'Drop in your courses, credits and letters — get the credits-weighted GPA with the arithmetic visible, your degree-class band, and what it takes to hit a target.',
  hubBlurb: 'credits-weighted GPA and CGPA from a pasted course list, with the per-course working and the catch-up sum to reach a target',
  lead: 'A GPA is a <b>weighted</b> mean: an A in a 4-credit course moves it four times as far as an A in a 1-credit lab. This page sums credit × grade-point over total credits (the 4.00 scale: A=4.0 down to F=0.0, halves worth 0.3), shows every line of the working, and then answers the question students actually ask — <b>how many credits of straight-A study</b> to reach a target CGPA.',
  form: `<div class="tl-form">
  ${field('Courses — one per line: name, credits, grade', '<textarea id="gp-in" rows="7" spellcheck="false">CS101, 3, A\nMATH202, 4, B+\nENG101, 3, A-\nPHY201, 4, B</textarea>')}
  ${field('Target CGPA (optional)', '<input id="gp-goal" type="number" min="0" max="4" step="0.01" value="3.50">')}
  <button class="tl-btn primary" id="gp-go" type="button">Calculate</button>
</div>
<div class="tl-res" id="gp-out">—</div>`,
  script: `
var $=function(id){return document.getElementById(id);};
var P={A:4,'A-':3.7,'B+':3.3,B:3,'B-':2.7,'C+':2.3,C:2,'C-':1.7,'D+':1.3,D:1,'D-':0.7,F:0};
function render(){var lines=$('gp-in').value.split(/\\r?\\n/),rows=[],cr=0,qp=0,bad=[];
 for(var i=0;i<lines.length;i++){var t=lines[i].split(/[,;\\t]+/);if(t.length<3||!/\\S/.test(t[0]))continue;
  var c=parseFloat(t[1]),g=(t[2]||'').trim().toUpperCase();
  if(!(c>0&&c<=12)||P[g]===undefined){bad.push(lines[i]);continue;}
  rows.push({n:t[0].trim(),c:c,g:g,p:P[g]});cr+=c;qp+=c*P[g];}
 if(!rows.length){$('gp-out').innerHTML='<span class="tl-badge tl-no">check input</span> One course per line as <i>name, credits, grade</i> — grades A to F with + and -.';return;}
 var gpa=cr>0?qp/cr:0;
 var cls=gpa>=3.7?'First class / magna cum laude':gpa>=3.3?'Second class upper / cum laude':gpa>=3.0?'Second class lower':gpa>=2.0?'Pass':'below the 2.0 pass mark';
 var html='<div class="tl-big">'+gpa.toFixed(2)+' / 4.00</div>';
 html+='<table class="tl-tab"><tbody><tr><td>Course</td><td>Credits</td><td>Grade</td><td>Points</td></tr>';
 rows.forEach(function(r){html+='<tr><td>'+r.n+'</td><td>'+r.c+'</td><td>'+r.g+'</td><td>'+(r.c*r.p).toFixed(2)+'</td></tr>';});
 html+='<tr><td><b>Totals</b></td><td><b>'+cr+'</b></td><td></td><td><b>'+qp.toFixed(2)+'</b></td></tr></tbody></table>';
 html+='<p>Quality points ÷ credits = '+qp.toFixed(2)+' / '+cr+' = <b>'+gpa.toFixed(2)+'</b> — '+cls+'.</p>';
 var goal=parseFloat($('gp-goal').value);
 if(!isNaN(goal)){if(goal<=gpa){html+='<p><span class="tl-badge tl-ok">target met</span> You are already at or above '+goal.toFixed(2)+'.</p>';}
  else{var need=(goal*cr-qp)/(4-goal);
   html+='<p>To pull the CGPA to '+goal.toFixed(2)+', you need <b>'+Math.ceil(need)+' credits</b> graded entirely A (≈ '+Math.ceil(need/3)+' typical course'+(Math.ceil(need/3)===1?'':'s')+').</p>';}}
 if(bad.length)html+='<p class="meta">Not understood: '+bad.join(' · ')+'</p>';
 html+='<p class="meta">Standard 4.00 mapping (A 4.0, A- 3.7, B+ 3.3 … F 0). Universities that use 4.3 or 5.0 scales grade the same way in spirit — check your registrar\\u2019s table before celebrating.</p>';
 $('gp-out').innerHTML=html;}
$('gp-go').onclick=render;$('gp-in').oninput=render;$('gp-goal').oninput=render;render();`,
  seo: `<h2 class="section-title">Why the unweighted average is the wrong answer</h2>
  <p>Averaging letter grades as if every course counted equally treats a one-credit lab the same as a four-credit core — and that is exactly how students accidentally report a number their transcript does not contain. Credits are the weights, full stop. The catch-up line is the same arithmetic read backwards: to reach target T from current credits C and quality points Q, future straight-A credits x must satisfy (Q+4x)/(C+x)=T, so x=(T·C−Q)/(4−T). When T approaches 4.0 that denominator shrinks and the required credits explode — which is the honest way of saying a 3.94 CGPA from a 3.2 start is not a plan, it is a wish.</p>`,
});

// ── 51. /alat/shoe — shoe size converter ─────────────────────────────────────
TOOLKIT.push({
  slug: 'shoe', ic: '👟', name: 'Shoe Size Converter',
  title: 'Shoe Size Converter — cm (Mondopoint), EU, UK & US | Tukuk-OS',
  desc: 'Convert foot length in centimetres to EU, UK and US sizes (or back from any of them), using the published formulas with the half-size rounding shops actually use. Honest tolerance notes included. In your browser.',
  hero: 'Shoe Size Converter', sub: 'cm ⇄ EU ⇄ UK ⇄ US · Brannock & Paris point · men & women',
  navBlurb: 'Foot length in centimetres to EU, UK and US sizes and back — the real formulas (Paris point, Brannock barleycorns) instead of a table you cannot check.',
  hubBlurb: 'centimetres to EU, UK and US shoe sizes and back, from the published formulas, with the ±half-size brand tolerance spelled out',
  lead: 'Every shoe scale is the same length measurement in different units: EU uses the <b>Paris point</b> (1.5 × last length in cm), UK and US use <b>barleycorns</b> (⅓ inch steps, the Brannock formula for men), and cm is Mondopoint — the only one that is literally your foot. This page converts between them with the allowance built in (EU adds 1.5 cm of last, Brannock works from foot length directly) and says the quiet part out loud: <b>brand lasts vary by half a size</b>, so treat the answers as the start of a fitting, not the end.',
  form: `<div class="tl-form">
  ${field('Known measurement', '<select id="sh-mode"><option value="cm" selected>foot length in cm</option><option value="eu">EU size</option><option value="ukm">UK men\\u2019s</option><option value="usm">US men\\u2019s</option></select>')}
  ${field('Value', '<input id="sh-v" type="number" min="14" max="35" step="0.1" value="25">')}
  <button class="tl-btn primary" id="sh-go" type="button">Convert</button>
</div>
<div class="tl-res" id="sh-out">—</div>`,
  script: `
var $=function(id){return document.getElementById(id);};
function half(x){return Math.round(x*2)/2;}
function cmOf(v,m){if(m==='cm')return v;if(m==='eu')return v/1.5-1.5;if(m==='ukm')return (v+23)/3*2.54;return (v+22)/3*2.54;}
function render(){var v=parseFloat($('sh-v').value),m=$('sh-mode').value;
 if(!(v>=14&&v<=51)){$('sh-out').innerHTML='<span class="tl-badge tl-no">check input</span> A foot length of 14-35 cm, or the matching EU/UK/US number.';return;}
 var cm=cmOf(v,m);
 if(cm<14||cm>35){$('sh-out').innerHTML='<span class="tl-badge tl-no">check input</span> That converts to a foot length outside 14-35 cm — double-check the scale you picked.';return;}
 var eu=1.5*(cm+1.5),usm=3*(cm/2.54)-22,ukm=usm-1,usw=usm+1.5;
 var html='<div class="tl-big">EU '+half(eu).toFixed(1).replace(/\\.0$/,'')+'</div>';
 html+='<table class="tl-tab"><tbody>';
 html+='<tr><td>Foot length (Mondopoint)</td><td>'+cm.toFixed(1)+' cm — the only number here that is a real measurement</td></tr>';
 html+='<tr><td>EU (Paris point)</td><td>'+half(eu)+' — 1.5 × (cm + 1.5 cm last)</td></tr>';
 html+='<tr><td>UK men</td><td>'+half(ukm)+' — barleycorns: 3 × inches − 23</td></tr>';
 html+='<tr><td>US men</td><td>'+half(usm)+' — Brannock: 3 × inches − 22</td></tr>';
 html+='<tr><td>US women</td><td>'+half(usw)+' — the common +1.5 brand offset</td></tr>';
 html+='</tbody></table><p class="meta">Rounded to the half size shops sell. The honest tolerance is ±0.5 — lasts differ between brands, and width (2E vs D) shifts the feel more than any scale here. If two sizes are within half a point, size down for sneakers, up for boots.</p>';
 $('sh-out').innerHTML=html;}
$('sh-go').onclick=render;$('sh-v').oninput=render;$('sh-mode').onchange=render;render();`,
  seo: `<h2 class="section-title">Three units and one foot</h2>
  <p>The barleycorn (⅓ inch) was legally fixed in 12th-century England and never left: UK and US sizes are foot length in inches times three, offset by 23 or 22 depending on the men/women scale. Europe went metric in the 1900s — the Paris point is ⅔ cm, and a shoe\\u2019s EU size is 1.5 × the <i>last</i> (the wooden foot it is built on), which is why the formula carries a +1.5 cm allowance. Mondopoint just states the foot in millimetres, which is why it is the only scale that transfers perfectly between brands. Converting between them is algebra; converting between brands is a half-size coin toss — this page gives you the algebra and tells you where the coin toss starts.</p>`,
});

// ── 52. /alat/screen — screen size & PPI comparison ─────────────────────────
TOOLKIT.push({
  slug: 'screen', ic: '📱', name: 'Screen & PPI',
  title: 'Screen Size Comparison — Inches, cm, Aspect & Pixel Density | Tukuk-OS',
  desc: 'Diagonal and resolution to physical width, height and pixel density (PPI) for two screens side by side, with the honest area comparison the marketing diagonal hides. Pythagoras, in your browser.',
  hero: 'Screen & PPI', sub: 'two screens · real width & height · PPI sharpness · area % truth',
  navBlurb: 'Put any two screens side by side and get real width, height and pixel density — plus the area comparison a diagonal-inches number is designed to hide.',
  hubBlurb: 'two screens compared on the numbers that matter — physical width and height, PPI, and the area percentage the diagonal hides',
  lead: 'A diagonal flatters big screens twice: area grows with the <b>square</b> of the diagonal, and a "13-inch" laptop is really about 28.7 × 18 cm of glass at 16:10. This page takes diagonal + pixel resolution (which fully determine the aspect ratio) and returns true width, height, and <b>PPI = √(w²+h²)/diagonal</b> for two devices at once — then compares them the way your eye actually experiences it: dots per inch and square inches.',
  form: `<div class="tl-form">
  ${field('Screen A — diagonal (in)', '<input id="sc-da" type="number" min="1" max="120" step="0.1" value="15.6">')}
  ${field('A — resolution', '<input id="sc-ra" type="text" value="1920x1080" size="12">')}
  ${field('Screen B — diagonal (in)', '<input id="sc-db" type="number" min="1" max="120" step="0.1" value="11">')}
  ${field('B — resolution', '<input id="sc-rb" type="text" value="2560x1600" size="12">')}
  <button class="tl-btn primary" id="sc-go" type="button">Compare</button>
</div>
<div class="tl-res" id="sc-out">—</div>`,
  script: `
var $=function(id){return document.getElementById(id);};
function parseRes(s){var m=/^\\s*(\\d{2,5})\\s*[x×*,\\/]\\s*(\\d{2,5})\\s*$/i.exec(s);return m?{w:+m[1],h:+m[2]}:null;}
function calc(d,res){var px=Math.sqrt(res.w*res.w+res.h*res.h);
 return{w:d*res.w/px,h:d*res.h/px,ppi:px/d,area:d*d*res.w*res.h/(px*px),ratio:res.w/res.h};}
function gcd(a,b){while(b){var t=a%b;a=b;b=t;}return a;}
function ratioLabel(w,h){var r=w/h,
 named=[[16/9,'16:9'],[16/10,'16:10'],[4/3,'4:3'],[3/2,'3:2'],[21/9,'21:9'],[5/4,'5:4'],[32/9,'32:9']];
 for(var i=0;i<named.length;i++)if(Math.abs(r-named[i][0])<0.01)return named[i][1];
 var g=gcd(w,h);return (w/g)+':'+(h/g);}
function render(){var da=parseFloat($('sc-da').value),db=parseFloat($('sc-db').value);
 var ra=parseRes($('sc-ra').value),rb=parseRes($('sc-rb').value);
 if(!(da>=1&&da<=120)||!ra||!(db>=1&&db<=120)||!rb){$('sc-out').innerHTML='<span class="tl-badge tl-no">check input</span> Diagonals 1-120 in, resolutions like 1920x1080.';return;}
 var A=calc(da,ra),B=calc(db,rb);
 var html='<div class="tl-big">'+A.ppi.toFixed(0)+' vs '+B.ppi.toFixed(0)+' ppi</div>';
 html+='<table class="tl-tab"><tbody><tr><td></td><td>Screen A</td><td>Screen B</td></tr>';
 html+='<tr><td>Diagonal</td><td>'+da+' in</td><td>'+db+' in</td></tr>';
 html+='<tr><td>Aspect</td><td>'+ratioLabel(ra.w,ra.h)+' ('+(ra.w/ra.h).toFixed(3)+')</td><td>'+ratioLabel(rb.w,rb.h)+' ('+(rb.w/rb.h).toFixed(3)+')</td></tr>';
 html+='<tr><td>Real width × height</td><td>'+A.w.toFixed(1)+' × '+A.h.toFixed(1)+' in ('+Math.round(A.w*2.54)+' × '+Math.round(A.h*2.54)+' cm)</td><td>'+B.w.toFixed(1)+' × '+B.h.toFixed(1)+' in ('+Math.round(B.w*2.54)+' × '+Math.round(B.h*2.54)+' cm)</td></tr>';
 html+='<tr><td>Glass area</td><td>'+A.area.toFixed(1)+' in²</td><td>'+B.area.toFixed(1)+' in²</td></tr>';
 html+='<tr><td>Pixel density</td><td>'+A.ppi.toFixed(0)+' ppi</td><td>'+B.ppi.toFixed(0)+' ppi</td></tr>';
 html+='<tr><td>Resolution</td><td>'+(ra.w*ra.h/1e6).toFixed(1)+' MP</td><td>'+(rb.w*rb.h/1e6).toFixed(1)+' MP</td></tr>';
 html+='</tbody></table>';
 var more=A.area>=B.area?['A','B',A.area/B.area]:['B','A',B.area/A.area];
 var denser=A.ppi>=B.ppi?['A','B',A.ppi/B.ppi]:['B','A',B.ppi/A.ppi];
 html+='<p><b>'+more[0]+'</b> shows <b>'+Math.round((more[2]-1)*100)+'% more picture</b> than '+more[1]+', and '+denser[0]+' is the denser panel — '+(denser[2]>=1.15?denser[0]+'\u2019s text is '+Math.round(denser[2]*100)/100+'\u00d7 as sharp':denser[2]>=0.87?'the two are about equally sharp':denser[0]+' is only marginally sharper')+'.</p>';
 html+='<p class="meta">"Retina" territory starts around 300 ppi for phones (held at ~25 cm) and ~220 ppi for laptops (at ~50 cm) — viewing distance decides, not the number alone.</p>';
 $('sc-out').innerHTML=html;}
$('sc-go').onclick=render;['sc-da','sc-db','sc-ra','sc-rb'].forEach(function(id){$(id).oninput=render;});render();`,
  seo: `<h2 class="section-title">Why diagonals lie about size</h2>
  <p>Two screens with the same diagonal can differ by 30% in area if their aspect ratios differ — a 16:10 panel and a 16:9 panel of the same diagonal are not the same purchase, because area is w × h and the diagonal only fixes the hypotenuse. The square-of-diagonal rule hurts marketing the other way too: going from a 6.1" to a 6.5" phone is a 13% area gain, not 7%, and that is the number your thumb feels. PPI has a similar trap: it measures dots, not legibility — at a metre away, 110 ppi looks fine, which is why desktop monitors got big before they got dense. The honest comparison is all three lines on this page together.</p>`,
});

// ── 53. /alat/metronome — web audio metronome ───────────────────────────────
TOOLKIT.push({
  slug: 'metronome', ic: '🎵', name: 'Metronome',
  title: 'Metronome — 40 to 208 BPM With Tempo Names | Tukuk-OS',
  desc: 'A Web Audio metronome: any tempo from 40 to 208 BPM, accented downbeats, 2/3/4/6 beats per bar, and the classical tempo names with their metronome ranges. Synthesised clicks, zero downloads.',
  hero: 'Metronome', sub: '40–208 BPM · accent on 1 · bar counter · the tempo names, defined',
  navBlurb: 'A precise click track from the browser\\u2019s own audio clock — 40 to 208 BPM, accented first beat, 2/3/4/6 per bar, and the Andante-to-Presto names the sheet music promises.',
  hubBlurb: 'a Web Audio click track from 40 to 208 BPM with accented downbeats and the classical tempo ranges beside every number',
  lead: 'The click is synthesised on demand — a short sine blip, 1200 Hz on the downbeat and 800 Hz inside the bar, the way a mechanical metronome goes <i>ping</i>-po-po. Scheduling uses a look-ahead loop rather than one timer per beat, so browser timer jitter never accumulates into a drifting pulse. Every tempo number below comes from the standard Maelzel/metronome mapping the sheet-music words promise.',
  form: `<div class="tl-form">
  ${field('Tempo (BPM)', '<input id="mt-bpm" type="number" min="40" max="208" step="1" value="100">')}
  ${field('Beats per bar', '<select id="mt-beats"><option value="2">2</option><option value="3">3</option><option value="4" selected>4</option><option value="6">6</option></select>')}
  <button class="tl-btn primary" id="mt-go" type="button">▶ Start</button>
  <button class="tl-btn" id="mt-tap" type="button">Tap tempo</button>
</div>
<div class="tl-res" id="mt-out">—</div>`,
  css: `
.mt-pulse{display:inline-block;width:14px;height:14px;border-radius:50%;background:#e3e6ec;margin:0 5px;vertical-align:middle;opacity:.35}
.mt-pulse.mt-on{opacity:1;background:#6366f1}
.mt-pulse.mt-accent{background:#f59e0b}`,
  script: `
var $=function(id){return document.getElementById(id);};
var NAMES=[[40,60,'Largo','broad and slow'],[60,76,'Adagio','slow and stately'],[76,108,'Andante','walking pace'],[108,120,'Moderato','at a moderate pace'],[120,156,'Allegro','fast and bright'],[156,176,'Vivace','lively and fast'],[176,209,'Presto','very fast']];
var ctx=null,timer=null,nextAt=0,beat=0,bar=0,playing=false,taps=[];
function name(bpm){for(var i=0;i<NAMES.length;i++)if(bpm>=NAMES[i][0]&&bpm<NAMES[i][1])return NAMES[i];return null;}
function dots(){var n=parseInt($('mt-beats').value,10),h='';for(var i=0;i<n;i++)h+='<span class="mt-pulse" data-b="'+i+'"></span>';return h;}
function idle(){var n=name(parseFloat($('mt-bpm').value)||100);
 $('mt-out').innerHTML='<div class="tl-big">'+($('mt-bpm').value||'—')+' BPM</div><p>'+(n?'<b>'+n[2]+'</b> — '+n[3]+' ('+n[0]+'\\u2013'+(n[1]-1)+' BPM).':'Out of the named range.')+' Beats per bar: '+$('mt-beats').value+'. Press \\u25b6 Start — the downbeat is accented and higher-pitched.</p><p>'+dots()+'</p><h3 class="section-title">The tempo vocabulary</h3><table class="tl-tab"><tbody><tr><td>Name</td><td>Range</td><td>Meaning</td></tr>'+NAMES.map(function(x){return '<tr><td>'+x[2]+'</td><td>'+x[0]+'\\u2013'+(x[1]-1)+'</td><td>'+x[3]+'</td></tr>';}).join('')+'</tbody></table>';}
function click(at,accent){var o=ctx.createOscillator(),g=ctx.createGain();
 o.frequency.value=accent?1200:800;o.type='sine';
 g.gain.setValueAtTime(0.0001,at);g.gain.exponentialRampToValueAtTime(accent?0.9:0.5,at+0.005);
 g.gain.exponentialRampToValueAtTime(0.0001,at+0.06);
 o.connect(g);g.connect(ctx.destination);o.start(at);o.stop(at+0.07);}
function stop(){playing=false;if(timer)clearInterval(timer);timer=null;$('mt-go').textContent='\\u25b6 Start';idle();}
function start(){if(playing){stop();return;}
 var AC=window.AudioContext||window.webkitAudioContext;if(!AC){$('mt-out').innerHTML='<span class="tl-badge tl-no">no audio</span> This browser has no Web Audio context.';return;}
 if(!ctx)ctx=new AC();if(ctx.state==='suspended')ctx.resume();
 var bpm=parseFloat($('mt-bpm').value),per=60/bpm;
 if(!(bpm>=40&&bpm<=208)){$('mt-out').innerHTML='<span class="tl-badge tl-no">check input</span> 40 to 208 BPM.';return;}
 beat=0;bar=0;playing=true;$('mt-go').textContent='\\u25a0 Stop';
 $('mt-out').innerHTML='<div class="tl-big">'+bpm+' BPM</div><p>Bar <b id="mt-bar">1</b> \\u00b7 '+(name(bpm)?name(bpm)[2]:'unnamed tempo')+'</p><p>'+dots()+'</p><p class="meta">Look-ahead scheduling keeps the click on the audio clock even when the page timer stutters.</p>';
 var sched=function(){while(nextAt<ctx.currentTime+0.12){var accent=beat%parseInt($('mt-beats').value,10)===0;
   click(nextAt,accent);
   (function(b){setTimeout(function(){var els=document.querySelectorAll('.mt-pulse');
     for(var i=0;i<els.length;i++)els[i].className='mt-pulse';
     var t=b%parseInt($('mt-beats').value,10);if(els[t])els[t].className='mt-pulse mt-on'+(t===0?' mt-accent':'');},Math.max(0,(b-nextAt)*1000));})(nextAt);
   beat++;if(beat%parseInt($('mt-beats').value,10)===0){bar++;var bb=document.getElementById('mt-bar');if(bb)bb.textContent=String(bar+1);}
   nextAt+=per;}};
 nextAt=ctx.currentTime+0.06;timer=setInterval(sched,40);sched();}
$('mt-tap').onclick=function(){var now=Date.now();taps.push(now);if(taps.length>5)taps=taps.slice(-5);
 if(taps.length>=2){var span=taps[taps.length-1]-taps[0],avg=span/(taps.length-1);
  var bpm=Math.round(60000/avg);if(bpm>=40&&bpm<=208){$('mt-bpm').value=bpm;idle();}}};
$('mt-go').onclick=start;$('mt-bpm').oninput=idle;$('mt-beats').onchange=idle;idle();`,
  seo: `<h2 class="section-title">Why "Andante" needs a metronome mark anyway</h2>
  <p>Tempo words are not fixed speeds: Beethoven\\u2019s own table bolted Maelzel\\u2019s new metronome numbers onto the words in 1817, and scholars still fight about the edges — Andante meant walking pace, but people walk at 76 and at 108. The ranges printed above are the conventional modern reading, and they are guidelines: the metronome exists to keep <i>your</i> chosen tempo, which is the only number that survives a rehearsal. The accent pattern matters as much as the speed — a click track without a downbeat makes practice slower than playing, because you cannot count bars, only beats.</p>`,
});
// ── 54. /alat/stopwatch — stopwatch with laps ───────────────────────────────
TOOLKIT.push({
  slug: 'stopwatch', ic: '⏱️', name: 'Stopwatch & Laps',
  title: 'Stopwatch With Laps — Split Times, Best & Worst | Tukuk-OS',
  desc: 'A centisecond stopwatch with lap splits, fastest/slowest lap detection and total time — the clock comes from Date.now(), so tab throttling cannot drift it. No download, no account.',
  hero: 'Stopwatch & Laps', sub: 'centiseconds · laps with splits · best & worst · Date.now clock',
  navBlurb: 'A lap-split stopwatch whose time comes from the system clock, not a ticking counter — background-tab throttling cannot make it drift a single millisecond.',
  hubBlurb: 'a centisecond stopwatch with lap splits and fastest/slowest detection, clocked from Date.now so throttling cannot drift it',
  lead: 'The usual way to write a stopwatch — add 10 ms every 10 ms — drifts with every timer the browser decides to delay, and a backgrounded tab can lose seconds. This one stores <b>start timestamps from the system clock</b> and does subtraction, so even if the display skips, the numbers never do. Laps are differences of the same clock, which makes the split table exact.',
  form: `<div class="tl-form">
  <div class="tl-big" id="sw-time" style="text-align:center;font-size:2.6rem">00:00.00</div>
  <button class="tl-btn primary" id="sw-go" type="button">Start</button>
  <button class="tl-btn" id="sw-lap" type="button" disabled>Lap</button>
  <button class="tl-btn" id="sw-rs" type="button" disabled>Reset</button>
</div>
<div class="tl-res" id="sw-out">—</div>`,
  script: `
var $=function(id){return document.getElementById(id);};
var base=0,startedAt=0,tick=null,laps=[],running=false;
function fmt(ms){if(ms<0)ms=0;var cs=Math.floor(ms/10)%100,s=Math.floor(ms/1000)%60,m=Math.floor(ms/60000)%60,h=Math.floor(ms/3600000);
 return (h>0?(h<10?'0':'')+h+':':'')+(m<10?'0':'')+m+':'+(s<10?'0':'')+s+'.'+(cs<10?'0':'')+cs;}
function elapsed(){return running?Date.now()-startedAt+base:base;}
function paint(){$('sw-time').textContent=fmt(elapsed());}
function lapTable(){if(!laps.length){$('sw-out').innerHTML='<p class="meta">Press Lap while running to record splits.</p>';return;}
 var best=Infinity,worst=-Infinity;
 laps.forEach(function(l){if(l.split<best)best=l.split;if(l.split>worst)worst=l.split;});
 var html='<table class="tl-tab"><tbody><tr><td>Lap</td><td>Split</td><td>Total</td></tr>';
 laps.forEach(function(l,i){html+='<tr><td>'+(i+1)+'</td><td>'+fmt(l.split)+(l.split<=best?' <span class="tl-badge tl-ok">best</span>':(l.split>=worst&&worst!==best?' <span class="tl-badge tl-no">worst</span>':''))+'</td><td>'+fmt(l.total)+'</td></tr>';});
 var sum=laps.reduce(function(a,l){return a+l.split;},0);
 html+='</tbody></table><p>'+laps.length+' laps \\u00b7 average split '+fmt(sum/laps.length)+' \\u00b7 spread '+fmt(worst-best)+'</p>';
 $('sw-out').innerHTML=html;}
function stopTick(){if(tick){clearInterval(tick);tick=null;}}
$('sw-go').onclick=function(){if(running){running=false;base=elapsed();stopTick();$('sw-go').textContent='Resume';$('sw-rs').disabled=false;$('sw-lap').disabled=true;}
 else{running=true;startedAt=Date.now();$('sw-go').textContent='Pause';$('sw-lap').disabled=false;stopTick();tick=setInterval(paint,50);}};
$('sw-lap').onclick=function(){if(!running)return;var t=elapsed(),prev=laps.length?laps[laps.length-1].total:0;
 laps.push({total:t,split:t-prev});paint();lapTable();};
$('sw-rs').onclick=function(){running=false;base=0;laps=[];stopTick();$('sw-time').textContent='00:00.00';$('sw-go').textContent='Start';$('sw-lap').disabled=true;$('sw-rs').disabled=true;lapTable();};
$('sw-lap').disabled=true;
paint();lapTable();`,
  seo: `<h2 class="section-title">Why a stopwatch is a subtraction, not a counter</h2>
  <p>Browsers deliberately delay timers in hidden tabs — a <code>setInterval</code> asked for every 50 ms may only wake once a second there, and a stopwatch built by adding ticks would then report a 100 m sprint as 20 seconds. The fix is to never accumulate: store the start moment from the system clock, subtract on every paint, and treat the display timer as decoration. The same discipline powers the lap list — a split is two elapsed readings taken at different moments, so throttling between them changes nothing. If you\\u2019ve ever seen a phone stopwatch "catch up" after you switch back to it, that\\u2019s this design working; one that quietly loses the time instead is the broken kind.</p>`,
});

// ── 55. /alat/blood-type — blood group inheritance ──────────────────────────
TOOLKIT.push({
  slug: 'blood-type', ic: '🩸', name: 'Blood Type Punnett',
  title: 'Blood Type Calculator — Punnett Square for ABO Inheritance | Tukuk-OS',
  desc: 'Pick both parental ABO genotypes and get the children\\u2019s phenotype odds from a real 2×2 Punnett square — A, B, AB, O with the allele combinations shown. Mendel, in your browser.',
  hero: 'Blood Type Punnett', sub: 'ABO genotypes · 2×2 cross · phenotype % · the classic surprises',
  navBlurb: 'The ABO cross done honestly as a Punnett square — pick both parents\\u2019 genotypes and see why two group-A parents can have an O child, with every odds percentage.',
  hubBlurb: 'a 2×2 Punnett square of ABO genotypes returning children\\u2019s phenotype odds and the classic inheritance surprises',
  lead: 'ABO blood is three alleles with two dominances: <b>A and B are codominant</b>, both <b>dominant over O</b>. Phenotype hides genotype — group A is AA or AO — so this page takes the <i>genotypes</i> and lays out the actual 2×2 square. The famous punchlines fall out of it: two A parents can have an O child, and an A × B couple can have <i>any</i> of the four groups.',
  form: `<div class="tl-form">
  ${field('Parent 1 genotype', '<select id="bd-p1"><option value="AA">AA (group A)</option><option value="AO" selected>AO (group A, carrier)</option><option value="BB">BB (group B)</option><option value="BO">BO (group B, carrier)</option><option value="AB">AB (group AB)</option><option value="OO">OO (group O)</option></select>')}
  ${field('Parent 2 genotype', '<select id="bd-p2"><option value="AA">AA (group A)</option><option value="AO" selected>AO (group A, carrier)</option><option value="BB">BB (group B)</option><option value="BO">BO (group B, carrier)</option><option value="AB">AB (group AB)</option><option value="OO">OO (group O)</option></select>')}
</div>
<div class="tl-res" id="bd-out">—</div>`,
  script: `
var $=function(id){return document.getElementById(id);};
function pheno(g){if(g==='AA'||g==='AO')return 'A';if(g==='BB'||g==='BO')return 'B';if(g==='AB')return 'AB';return 'O';}
function combo(x,y){var s=[x,y].sort();
 if(s[0]==='A'&&s[1]==='B')return 'AB';if(s[0]==='A'&&s[1]==='O')return 'AO';
 if(s[0]==='B'&&s[1]==='O')return 'BO';return s[0]+s[1];}
function render(){var p1=$('bd-p1').value,p2=$('bd-p2').value;
 var a1=[p1[0],p1[1]],a2=[p2[0],p2[1]];
 var cells=[],ph={};
 a1.forEach(function(x){a2.forEach(function(y){var g=combo(x,y);cells.push([x,y,g]);ph[pheno(g)]=(ph[pheno(g)]||0)+1;});});
 var order=['A','B','AB','O'],html='';
 html+='<div class="tl-big">'+order.filter(function(p){return ph[p];}).map(function(p){return p+' '+ph[p]*25+'%';}).join(' \\u00b7 ')+'</div>';
 html+='<table class="tl-tab"><tbody><tr><td></td><td>'+a2[0]+'</td><td>'+a2[1]+'</td></tr>';
 html+='<tr><td>'+a1[0]+'</td><td>'+cells[0][2]+'</td><td>'+cells[1][2]+'</td></tr>';
 html+='<tr><td>'+a1[1]+'</td><td>'+cells[2][2]+'</td><td>'+cells[3][2]+'</td></tr>';
 html+='</tbody></table><table class="tl-tab"><tbody><tr><td>Child genotype</td><td>Phenotype</td><td>Odds</td></tr>';
 cells.forEach(function(c){html+='<tr><td>'+c[2]+'</td><td>'+pheno(c[2])+'</td><td>25%</td></tr>';});
 html+='</tbody></table>';
 var surp='';
 if(ph['O']&&p1!=='OO'&&p2!=='OO')surp='<p><span class="tl-badge tl-ok">the classic surprise</span> Neither parent is group O, yet an O child is possible — both were carriers.</p>';
 if(ph['A']&&ph['B']&&ph['AB']&&ph['O'])surp+='<p>All four groups are possible from this pair — the textbook A × B with both carrying O.</p>';
 html+=surp+'<p class="meta">Rh+/\\u2212 (the D antigen) is a separate gene and not modelled here. Rare mutations (Bombay phenotype etc.) can break these odds; this is classroom genetics, not paternity science.</p>';
 $('bd-out').innerHTML=html;}
$('bd-p1').onchange=render;$('bd-p2').onchange=render;render();`,
  seo: `<h2 class="section-title">Codominance, dominance, and the carrier trick</h2>
  <p>Mendel\\u2019s pea colours showed dominance; ABO adds codominance on top. An AO person types as A because the A allele builds an A antigen on every red cell and the O allele builds nothing — dominance is a statement about what the <i>surface displays</i>, not what the DNA carries. An AB person displays both antigens side by side, which is why A and B are called codominant: neither hides the other. The carrier mechanic is why two group-A parents can have an O child (AO × AO gives 25% OO) and why group O appears suddenly in family trees — the genotype was invisible for a generation, not absent. The 2×2 square above is exactly the tool Reginald Punnett invented in 1905 for this arithmetic.</p>`,
});

// ── 56. /alat/dna — DNA complement & protein translation ────────────────────
TOOLKIT.push({
  slug: 'dna', ic: '🧬', name: 'DNA Translator',
  title: 'DNA Complement & Protein Translator — Codon Table, In Your Browser | Tukuk-OS',
  desc: 'Paste a DNA sequence and get the complement strand, the reverse complement (the lab answer), the mRNA transcript and the protein translated through the standard genetic code, with GC content. Local only.',
  hero: 'DNA Translator', sub: 'complement · reverse complement · mRNA · protein · GC% · codon table',
  navBlurb: 'Complement, reverse complement, mRNA and the actual protein from the standard codon table — the four readings every genetics course asks for, computed on your device.',
  hubBlurb: 'DNA to complement, reverse complement, mRNA and protein via the standard genetic code, with GC content',
  lead: 'The genetic code is a lookup table, so this is pure translation work: <b>A pairs with T, C with G</b>; the complement is read <b>3′→5′</b> which is why labs quote the <b>reverse complement</b>; mRNA is the coding strand with U for T; and every three-base codon maps to an amino acid through the <b>NCBI standard table</b> (translation stops at the first stop codon). Sequence never leaves the page — a real genome pasted here stays yours.',
  form: `<div class="tl-form">
  ${field('DNA sequence 5′→3′ (A/C/G/T, spaces ignored)', '<textarea id="dn-in" rows="4" spellcheck="false">ATGGCATCGGTCTAA</textarea>')}
  <button class="tl-btn primary" id="dn-go" type="button">Translate</button>
</div>
<div class="tl-res" id="dn-out">—</div>`,
  script: `
var $=function(id){return document.getElementById(id);};
var BT='FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG';
var IDX={'T':0,'C':1,'A':2,'G':3};
var AA={F:'Phe',L:'Leu',S:'Ser',Y:'Tyr','*':'Stop',C:'Cys',W:'Trp',P:'Pro',H:'His',Q:'Gln',R:'Arg',I:'Ile',M:'Met',T:'Thr',N:'Asn',K:'Lys',V:'Val',A:'Ala',D:'Asp',E:'Glu',G:'Gly'};
var CMP={A:'T',T:'A',C:'G',G:'C'};
function render(){var raw=$('dn-in').value.toUpperCase().replace(/\\s+/g,'');
 if(!raw){$('dn-out').innerHTML='<span class="tl-badge tl-no">check input</span> Paste a sequence of A, C, G and T.';return;}
 if(/[^ACGT]/.test(raw)){$('dn-out').innerHTML='<span class="tl-badge tl-no">check input</span> RNA letters (U) or ambiguity codes are not accepted — only ACGT, after stripping spaces.';return;}
 var comp=raw.split('').map(function(b){return CMP[b];}).join('');
 var rc=comp.split('').reverse().join('');
 var mrna=raw.split('').map(function(b){return b==='T'?'U':b;}).join('');
 var prot='',codons=[],i;
 for(i=0;i+3<=raw.length;i+=3){var c=raw.substr(i,3),a=BT[16*IDX[c[0]]+4*IDX[c[1]]+IDX[c[2]]];
  codons.push(c+'\\u2192'+a);prot+=a;if(a==='*')break;}
 var stops=prot.indexOf('*');var shown=stops>=0?prot.substring(0,stops):prot;
 var gc=(raw.split('').filter(function(b){return b==='G'||b==='C';}).length/raw.length*100);
 var spaced=shown.split('').map(function(a){return AA[a];}).join('-');
 var html='<div class="tl-big">'+(shown?shown+' ('+spaced+')':'no coding start')+'</div>';
 html+='<table class="tl-tab"><tbody>';
 html+='<tr><td>Length</td><td>'+raw.length+' bases'+(raw.length%3?' — not a whole codon count; '+(raw.length%3)+' trailing base(s) ignored':' \\u00d7 3 = '+Math.floor(raw.length/3)+' codons')+'</td></tr>';
 html+='<tr><td>Complement (3\\u2032\\u21925\\u2032)</td><td style="word-break:break-all">'+comp+'</td></tr>';
 html+='<tr><td>Reverse complement</td><td style="word-break:break-all">'+rc+'</td></tr>';
 html+='<tr><td>mRNA (5\\u2032\\u21923\\u2032)</td><td style="word-break:break-all">'+mrna+'</td></tr>';
 html+='<tr><td>Stop codon</td><td>'+(stops>=0?codons[stops]+' at position '+(stops*3+1)+' — translation ends there':'none in this stretch')+'</td></tr>';
 html+='<tr><td>GC content</td><td>'+gc.toFixed(1)+'% — PCR primer pairs aim for 40\\u201360%</td></tr>';
 html+='</tbody></table><p class="meta">Standard NCBI code table 1. Real genes also need a start codon context, intron splicing and frames — this translates the literal string, which is the right answer for homework, primers and the codon table itself.</p>';
 $('dn-out').innerHTML=html;}
$('dn-go').onclick=render;$('dn-in').oninput=render;render();`,
  seo: `<h2 class="section-title">Reverse complement: the strand biologists quote</h2>
  <p>DNA\\u2019s two strands run antiparallel — one 5\\u2032\\u21923\\u2032, the other 3\\u2032\\u21925\\u2032 — and polymerases only read 3\\u2032\\u21925\\u2032 while building 5\\u2032\\u21923\\u2032. So the matching strand of ATGCCC, written the conventional 5\\u2032\\u21923\\u2032 way, is <i>reversed</i> after complementing: GGGCAT. Sequence databases, primer design and BLAST hits are all quoted on this convention, which is why "just swap the letters" is the classic first mistake. The genetic code\\u2019s redundancy is the other half of the lesson: 64 codons for 20 amino acids means many third-position mutations are silent — leucine has six codons and the stop signal has three — a built-in error tolerance evolution kept when it stopped there.</p>`,
});

// ── 57. /alat/subnet — IPv4 subnet calculator ────────────────────────────────
TOOLKIT.push({
  slug: 'subnet', ic: '🕸️', name: 'Subnet Calculator',
  title: 'IPv4 Subnet Calculator — CIDR, Mask, Range & Hosts | Tukuk-OS',
  desc: 'Type any CIDR like 192.168.1.130/26 and get network address, broadcast, usable host range, mask and wildcard, block size and the next subnet — all from the prefix length, in your browser.',
  hero: 'Subnet Calculator', sub: 'CIDR · mask · wildcard · host range · block size · next subnet',
  navBlurb: 'The full IPv4 breakdown of any CIDR — network, broadcast, first and last usable address, mask and wildcard, and the next block in the allocation, by pure arithmetic.',
  hubBlurb: 'a CIDR breakdown — network, mask, wildcard, broadcast and usable host range of any IPv4 block, computed exactly',
  lead: 'A prefix length is just log arithmetic: <b>/26</b> means 26 mask bits, 6 host bits, a block of <b>2\\u2076 = 64 addresses</b>, of which the first is the network and the last the broadcast — <b>62 usable</b>. Everything below comes from those numbers with integer division; no lookup tables, no "class" folklore, and nothing is sent anywhere.',
  form: `<div class="tl-form">
  ${field('Address / prefix', '<input id="su-in" type="text" value="192.168.1.130/26" spellcheck="false" autocomplete="off">')}
  <button class="tl-btn primary" id="su-go" type="button">Calculate</button>
</div>
<div class="tl-res" id="su-out">—</div>`,
  script: `
var $=function(id){return document.getElementById(id);};
function d(u){return [Math.floor(u/16777216),Math.floor(u/65536)%256,Math.floor(u/256)%256,u%256].join('.');}
function render(){var m=/^\\s*(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})\\s*\\/\\s*(\\d{1,2})\\s*$/.exec($('su-in').value);
 if(!m||[m[1],m[2],m[3],m[4]].some(function(o){return +o>255;})){ $('su-out').innerHTML='<span class="tl-badge tl-no">check input</span> Dotted IPv4 with a CIDR prefix, like 10.5.0.1/16.';return;}
 var p=+m[5];if(p<0||p>32){$('su-out').innerHTML='<span class="tl-badge tl-no">check input</span> Prefix must be /0 to /32.';return;}
 var ip=((+m[1]*256+ +m[2])*256+ +m[3])*256+ +m[4];
 var hb=32-p,size=Math.pow(2,hb);
 var net=ip-(ip%size);
 var bcast=net+size-1,mask=4294967296-size,wild=size-1;
 var html,first,last,hostsN;
 if(p===32){first=last=ip;hostsN=1;}
 else if(p===31){first=net;last=bcast;hostsN=2;}
 else{first=net+1;last=bcast-1;hostsN=size-2;}
 html='<div class="tl-big">'+d(net)+' /'+p+'</div>';
 html+='<table class="tl-tab"><tbody>';
 html+='<tr><td>Address (as given)</td><td>'+d(ip)+'</td></tr>';
 html+='<tr><td>Network</td><td>'+d(net)+' — the block\\u2019s first address</td></tr>';
 html+='<tr><td>Subnet mask</td><td>'+d(mask)+' (/'+p+')</td></tr>';
 html+='<tr><td>Wildcard</td><td>'+d(wild)+' — the inverse, how ACLs state it</td></tr>';
 if(p<32)html+='<tr><td>Broadcast</td><td>'+d(bcast)+'</td></tr>';
 html+='<tr><td>Usable hosts</td><td>'+hostsN.toLocaleString('en-US')+(p<31?' (block of '+size.toLocaleString('en-US')+' minus network'+(p<32?' and broadcast':'')+')':'')+'</td></tr>';
 html+='<tr><td>First / last usable</td><td>'+d(first)+' \\u2026 '+d(last)+'</td></tr>';
 html+='<tr><td>Next subnet</td><td>'+(size<4294967296?d(net+size)+' /'+p:'—')+'</td></tr>';
 html+='<tr><td>Big block fact</td><td>'+ (p<=24?(size/256).toFixed(size%256?1:0)+' class-C-sized blocks in this range':'fits inside one /24')+'</td></tr>';
 html+='</tbody></table>';
 var notNet=(ip%size!==0);
 if(notNet)html+='<p><span class="tl-badge tl-ok">note</span> Your host part is non-zero: '+d(ip)+' lives <i>inside</i> '+d(net)+'/'+p+' rather than being the network address itself — routers and configs want the CIDR block stated as '+d(net)+'/'+p+'.</p>';
 html+='<p class="meta">/31 point-to-point links keep both addresses usable (RFC 3021); /32 is a single host. Everything here is integer maths on 32-bit values — no bitwise sign traps, no network calls.</p>';
 $('su-out').innerHTML=html;}
$('su-go').onclick=render;$('su-in').oninput=render;render();`,
  seo: `<h2 class="section-title">Why /24 is not "254" anymore — and /26 is 62</h2>
  <p>Classful networking (the A/B/C folklore still haunting the word "class-C") died in 1993 with CIDR; what survived is the arithmetic: a prefix of p leaves 32\\u2212p host bits, and usable hosts are 2^(32\\u2212p) \\u2212 2 because the all-zero host address names the <i>network itself</i> and the all-ones one is the broadcast. A /26 block is 64 addresses, 62 usable — the number that decides whether a VLAN fits its DHCP scope. The second trap this page surfaces: people paste a host address and expect a network back; 192.168.1.130/26 is not a network at all — the containing block is .128/26, and the page says so rather than pretending the input was canonical.</p>`,
});
// ── 58. /alat/heartrate — training zones ─────────────────────────────────────
TOOLKIT.push({
  slug: 'heartrate', ic: '💓', name: 'HR Zones',
  title: 'Heart-Rate Zones — Karvonen Training Bands | Tukuk-OS',
  desc: 'Five training zones from age and resting heart rate using the Karvonen heart-rate-reserve method, with the Gellish max-HR formula and the 220−age myth shown side by side. In your browser.',
  hero: 'HR Zones', sub: 'Karvonen HRR · 5 zones · Gellish 207−0.7·age · real resting HR',
  navBlurb: 'Training zones computed the way exercise science does — heart-rate reserve from your <i>resting</i> rate, not raw percentages of a mythic 220-minus-age max.',
  hubBlurb: 'five Karvonen training zones from age and resting heart rate, with the better max-HR formulas beside the 220−age rule',
  lead: 'The famous %HRmax method is the rough one: two people with the same max but different fitness share zones it calls equal. <b>Karvonen</b> fixes this with heart-rate <i>reserve</i> — target = resting + intensity × (max − resting) — so zones scale with cardiovascular fitness. Max HR uses the meta-analysed <b>Gellish formula (207 \\u2212 0.7 × age)</b>; the textbook 220 \\u2212 age is shown for comparison because its ±10\\u201312 bpm error is why percentages-of-max drift. Zone boundaries are the standard five-band convention (50\\u201360 \\u2026 90\\u2013100% HRR).',
  form: `<div class="tl-form">
  ${field('Age (years)', '<input id="hz-age" type="number" min="10" max="100" step="1" value="30">')}
  ${field('Resting HR (bpm, first thing in the morning)', '<input id="hz-rest" type="number" min="30" max="110" step="1" value="60">')}
</div>
<div class="tl-res" id="hz-out">—</div>`,
  script: `
var $=function(id){return document.getElementById(id);};
function render(){var a=parseFloat($('hz-age').value),r=parseFloat($('hz-rest').value);
 if(!(a>=10&&a<=100)||!(r>=30&&r<=110)){$('hz-out').innerHTML='<span class="tl-badge tl-no">check input</span> Age 10-100, resting HR 30-110.';return;}
 var mhr=Math.round(207-0.7*a),hrr=mhr-r,fox=220-a,tnk=Math.round(208-0.7*a);
 var Z=[[50,60,'Z1','Recovery','very light \\u2014 warm-up, cool-down, fat oxidation'],
        [60,70,'Z2','Aerobic base','conversational pace \\u2014 where endurance is built'],
        [70,80,'Z3','Tempo','comfortably hard \\u2014 the grey zone most runners over-use'],
        [80,90,'Z4','Threshold','burning \\u2014 lactate threshold territory, interval work'],
        [90,100,'Z5','VO2 max','maximal \\u2014 short intervals only, if trained']];
 var html='<div class="tl-big">'+mhr+' bpm estimated max</div>';
 html+='<table class="tl-tab"><tbody><tr><td>Zone</td><td>% of HRR</td><td>From</td><td>To</td><td>Feels like</td></tr>';
 Z.forEach(function(z){var lo=Math.round(r+z[0]/100*hrr),hi=Math.round(r+z[1]/100*hrr);
  html+='<tr><td><b>'+z[2]+' '+z[3]+'</b></td><td>'+z[0]+'\\u2013'+z[1]+'</td><td>'+lo+'</td><td>'+hi+'</td><td>'+z[4]+'</td></tr>';});
 html+='</tbody></table><table class="tl-tab"><tbody>';
 html+='<tr><td>Heart-rate reserve</td><td>'+mhr+' \\u2212 '+r+' = '+hrr+' bpm \\u2014 the range your training actually uses</td></tr>';
 html+='<tr><td>Max-HR estimates</td><td>Gellish '+mhr+' \\u00b7 Tanaka '+tnk+' \\u00b7 220\\u2212age '+fox+' (the famous one, \\u00b110\\u201312 bpm error)</td></tr>';
 html+='<tr><td>Why resting matters</td><td>two 30-year-olds at rest 50 vs 70 differ by ~12 bpm in every Z2 boundary</td></tr>';
 html+='</tbody></table><p class="meta">Formulas estimate populations, not persons: measured max from a supervised test beats every line here. Medication (beta-blockers) flattens the whole scale \\u2014 ignore this page and ask your clinician.</p>';
 $('hz-out').innerHTML=html;}
$('hz-age').oninput=render;$('hz-rest').oninput=render;render();`,
  seo: `<h2 class="section-title">The 220-minus-age problem</h2>
  <p>The famous 220 \\u2212 age rule was never really derived \\u2014 it looks like a rough 1970s sketch with no published methodology behind it, and the meta-analysis that did have data (Gellish et al., 2007) landed on 207 \\u2212 0.7·age, with a ±10 bpm individual scatter that no formula removes. Percentages-of-max then compound the error: a 12 bpm wrong max shifts your "70% zone" by 8 bpm. Karvonen\\u2019s reserve method, formalised in 1957, anchors the bottom of the scale to your measured resting rate instead \\u2014 the number that <i>is</i> personal and improves with training, which is why athletes watch resting HR like a dashboard light.</p>`,
});

// ── 59. /alat/caffeine — caffeine decay tracker ──────────────────────────────
TOOLKIT.push({
  slug: 'caffeine', ic: '☕', name: 'Caffeine Half-Life',
  title: 'Caffeine Tracker — Half-Life Decay & Sleep Cut-Off | Tukuk-OS',
  desc: 'How much caffeine is still in your body at any hour after the last cup: exponential half-life decay with an hourly table, the time it drops below 100 mg, and a bedtime check. In your browser.',
  hero: 'Caffeine Decay', sub: 't\\u00bd \\u2248 5 h \\u00b7 exponential \\u00b7 hourly levels \\u00b7 below-100 mg time \\u00b7 sleep check',
  navBlurb: 'Track the exponential decay of your last coffee hour by hour — when the body load drops below 100 mg, and how much is still circulating when you plan to sleep.',
  hubBlurb: 'the half-life curve of caffeine after any dose, with the hour it drops below sleepy thresholds and a bedtime check',
  lead: 'Caffeine clears by <b>first-order kinetics</b>: a fixed proportion per hour, not a fixed amount — the same law as radioactivity and the compound-interest pages on this site. The average adult half-life is about <b>5 hours</b> (smokers metabolise roughly twice as fast, pregnancy slows it toward 8\\u201311, and individual CYP1A2 genetics spread it 1.5\\u20139.5 h). A 200 mg dose (\\u2248 two espressos or one large filter) therefore halves to 100 mg at +5 h, 50 mg at +10 h — which is why the 14:00 flat white is genuinely still 66 mg at 23:00.',
  form: `<div class="tl-form">
  ${field('Dose (mg)', '<input id="cf-mg" type="number" min="0" max="800" step="10" value="200">')}
  ${field('Taken at (clock time)', '<input id="cf-at" type="time" value="15:00">')}
  ${field('Your half-life', '<select id="cf-hl"><option value="3">~3 h \\u2014 fast metaboliser / smoker</option><option value="5" selected>~5 h \\u2014 average adult</option><option value="8">~8 h \\u2014 slow (pregnancy, some medications)</option></select>')}
  <button class="tl-btn primary" id="cf-go" type="button">Decay it</button>
</div>
<div class="tl-res" id="cf-out">—</div>`,
  css: `
.tl-badge.tl-warn{background:#b45309;color:#fff}`,
  script: `
var $=function(id){return document.getElementById(id);};
var dose=200,hl=5;
function mg(t){return dose*Math.pow(2,-t/hl);}
function clock(at,add){var p=at.split(':'),m=(+p[0])*60+(+p[1]||0)+Math.round(add*60);m=((m%1440)+1440)%1440;
 return ('0'+Math.floor(m/60)).slice(-2)+':'+('0'+(m%60)).slice(-2);}
function render(){dose=parseFloat($('cf-mg').value)||0;hl=parseFloat($('cf-hl').value)||5;
 var at=$('cf-at').value||'15:00';
 if(dose<1){$('cf-out').innerHTML='<span class="tl-badge tl-no">check input</span> A dose of at least 1 mg — an espresso is ~60, filter mug ~120, cold brew can reach 200.';return;}
 var html='<div class="tl-big">'+Math.round(dose)+' mg at '+at+'</div>';
 html+='<table class="tl-tab"><tbody><tr><td>Time</td><td>Body load</td><td>Share left</td></tr>';
 for(var t=0;t<=12;t+=2){html+='<tr><td>'+clock(at,t)+' (+'+t+' h)</td><td>'+ (t===0?Math.round(dose):mg(t).toFixed(0)) +' mg</td><td>'+Math.round(Math.pow(2,-t/hl)*100)+'%</td></tr>';}
 html+='</tbody></table>';
 var below100=dose>100?hl*Math.log(dose/100)/Math.LN2:0;
 html+='<table class="tl-tab"><tbody>';
 html+='<tr><td>First half-life</td><td>'+clock(at,hl)+' — '+Math.round(dose/2)+' mg still aboard</td></tr>';
 if(dose>100)html+='<tr><td>Drops below 100 mg</td><td>at '+clock(at,below100)+' ('+below100.toFixed(1)+' h) — the often-quoted sleep threshold</td></tr>';
 if(dose>=20){var sleepT=hl*Math.log(dose/20)/Math.LN2;
 html+='<tr><td>Down to a 20 mg trace</td><td>'+clock(at,sleepT)+' ('+sleepT.toFixed(1)+' h)</td></tr>';}
 var b8=mg(8);
 html+='<tr><td>Bedtime check (+8 h)</td><td>'+b8.toFixed(0)+' mg — '+(b8>100?'<span class="tl-badge tl-no">still a full half-dose</span>':(b8>40?'<span class="tl-badge tl-warn">noticeable</span>':'<span class="tl-badge tl-ok">mostly cleared</span>'))+'</td></tr>';
 html+='</tbody></table><p class="meta">Body load, not effect: adenosine receptors feel the tail long after the curve bottoms out, and sleep researchers (Drake et al., 2013) found caffeine 6 h before bed still cut sleep time. Half-lives are averages — your genetics, liver and pregnancy status are the real input.</p>';
 $('cf-out').innerHTML=html;}
$('cf-go').onclick=render;['cf-mg','cf-at','cf-hl'].forEach(function(id){$(id).oninput=render;$(id).onchange=render;});render();`,
  seo: `<h2 class="section-title">The half-life rule behind every line</h2>
  <p>Level(t) = dose × 2\\u2212(t/half-life) — one exponential, the same one the inflation and doubling-time pages on this site use, just with the arrow pointing down. The counter-intuitive consequence of first-order kinetics: the <i>second</i> 100 mg you take late in the day lands on top of whatever the first is still decaying into, so the afternoon coffee stack reaches bedtime larger than any single cup suggests. And because each half-life takes the same time regardless of how much is left, "a little more won\\u2019t hurt" is exactly how chronic intake accumulates — the curve is memoryless about your excuses.</p>`,
});

// ── 60. /alat/moon — moon phase calculator ───────────────────────────────────
TOOLKIT.push({
  slug: 'moon', ic: '🌙', name: 'Moon Phase',
  title: 'Moon Phase Calculator — Age, Illumination & Next New | Tukuk-OS',
  desc: 'The Moon\\u2019s age in days, the phase name, illuminated percentage and days to the next new moon for any date, from the mean synodic cycle (29.5306 d). Simple, honest maths in your browser.',
  hero: 'Moon Phase', sub: 'synodic age · illumination % · phase name · next new moon · ±1 day',
  navBlurb: 'The Moon\\u2019s age, phase name and lit fraction for any date from the mean synodic month — with the ±1 day accuracy honestly stated.',
  hubBlurb: 'the mean synodic cycle gives the Moon\\u2019s age, illumination and phase name for any calendar date',
  lead: 'The Moon is a three-body problem, but the <b>mean synodic month — 29.530588853 days</b> between new moons — answers "what phase is it roughly" to within a day. Anchor the cycle to a known new moon (6 January 2000, 18:14 UTC), take the day difference modulo the cycle length, and age, illumination (a cosine) and phase name all fall out. For garden planting, tides of mood and curiosity this is the right tool; for a launch window, take the ephemeris.',
  form: `<div class="tl-form">
  ${field('Date', '<input id="mn-d" type="date" value="2026-11-03">')}
  <button class="tl-btn primary" id="mn-go" type="button">Look up</button>
</div>
<div class="tl-res" id="mn-out">—</div>`,
  script: `
var $=function(id){return document.getElementById(id);};
var SYN=29.530588853,EPOCH=Date.UTC(2000,0,6,18,14);
var MO=['January','February','March','April','May','June','July','August','September','October','November','December'];
var PH=[[1.85,'\\ud83c\\udf11','New Moon'],[5.54,'\\ud83c\\udf12','Waxing Crescent'],[9.23,'\\ud83c\\udf13','First Quarter'],
 [12.92,'\\ud83c\\udf14','Waxing Gibbous'],[16.61,'\\ud83c\\udf15','Full Moon'],[20.30,'\\ud83c\\udf16','Waning Gibbous'],
 [23.99,'\\ud83c\\udf17','Last Quarter'],[27.68,'\\ud83c\\udf18','Waning Crescent'],[29.54,'\\ud83c\\udf11','New Moon']];
function dstr(dt){return dt.getUTCDate()+' '+MO[dt.getUTCMonth()]+' '+dt.getUTCFullYear();}
function render(){var v=$('mn-d').value;if(!v){$('mn-out').innerHTML='<span class="tl-badge tl-no">check input</span> Pick a date.';return;}
 var p=v.split('-');var at=Date.UTC(+p[0],+p[1]-1,+p[2],12);
 var days=(at-EPOCH)/864e5,age=((days%SYN)+SYN)%SYN;
 var ph=PH[PH.length-1];for(var i=0;i<PH.length;i++)if(age<PH[i][0]){ph=PH[i];break;}
 var il=(1-Math.cos(2*Math.PI*age/SYN))/2*100;
 var waxing=age<SYN/2;
 var html='<div class="tl-big">'+ph[1]+' '+ph[2]+'</div>';
 html+='<table class="tl-tab"><tbody>';
 html+='<tr><td>Lunar age</td><td>'+age.toFixed(1)+' days since the last new moon</td></tr>';
 html+='<tr><td>Illuminated</td><td>'+il.toFixed(0)+'% of the disk — '+(waxing?'growing, lit on the right':'shrinking, lit on the left')+'</td></tr>';
 var nn=new Date(at+(SYN-age)*864e5);
 html+='<tr><td>Next new moon</td><td>in about '+(SYN-age).toFixed(1)+' days — around '+dstr(nn)+'</td></tr>';
 var toFull=age<SYN/2?SYN/2-age:SYN-age+SYN/2,sinceFull=age>=SYN/2?age-SYN/2:-1;
 html+='<tr><td>Full moon</td><td>'+(sinceFull>=0?'was about '+sinceFull.toFixed(1)+' days ago; the next is in '+toFull.toFixed(1)+' days':'rising — full in about '+toFull.toFixed(1)+' days')+'</td></tr>';
 html+='</tbody></table><p class="meta">Mean-cycle maths: the Moon\\u2019s eccentric orbit makes real new moons arrive up to ~14 h early or late versus this estimate, and illumination is a first-order value. ±1 day is the honest precision.</p>';
 $('mn-out').innerHTML=html;}
$('mn-go').onclick=render;$('mn-d').oninput=render;render();`,
  seo: `<h2 class="section-title">Why "full moon tonight" is a fuzzy fact</h2>
  <p>The disk stays above 99% illuminated for roughly half a day around opposition, so two consecutive evenings both look full — astronomers speak of an <i>instant</i> of fullness, cultures of a <i>day</i>. The mean synodic month handles this cleanly because it averages the orbit\\u2019s eccentricity: the Moon swings faster near perigee, so true new moons drift up to ±14 hours from the mean, and that drift is why ancestor calendars that trusted only the mean eventually accumulated errors (the reform-era Easter tables needed real corrections for exactly this reason). For tide timing, fishing lore and garden calendars the mean cycle is more than sharp enough — and it is the only version arithmetic can reproduce.</p>`,
});

// ── 61. /alat/easter — Easter computus ───────────────────────────────────────
TOOLKIT.push({
  slug: 'easter', ic: '✝️', name: 'Easter Date',
  title: 'Easter Date Calculator — Western & Orthodox Computus | Tukuk-OS',
  desc: 'The exact Easter Sunday for any year, Western (Gregorian, Anonymous computus) and Orthodox (Julian + calendar offset), with golden number and epact shown. Pure calendar arithmetic, in your browser.',
  hero: 'Easter Date', sub: 'computus · golden number · epact · Western & Orthodox · 1583-4099',
  navBlurb: 'Easter Sunday for any year from the 6th-century algorithm the Church still uses — Western and Orthodox dates side by side, with the intermediate golden number and epact.',
  hubBlurb: 'Western and Orthodox Easter from the classical computus — golden number, epact and the full-moon-to-Sunday rule, for any year 1583-4099',
  lead: 'Easter is the first Sunday after the <b>ecclesiastical full moon</b> that falls on or after 21 March — a rule that needs no telescope, only arithmetic the Church formalised by the 8th century. The Gregorian implementation below is the <b>Anonymous computus</b> (the Oudin form used in every almanac), and the Orthodox date comes from the same rule kept on the Julian calendar, which now sits 13 days behind. The <b>golden number</b> (position in the 19-year Metonic cycle) and the <b>epact</b> (the moon\\u2019s age on 1 January) are shown because they are the actual intermediates.',
  form: `<div class="tl-form">
  ${field('Year (1583\\u20134099)', '<input id="ep-y" type="number" min="1583" max="4099" step="1" value="2026">')}
  <button class="tl-btn primary" id="ep-go" type="button">Compute</button>
</div>
<div class="tl-res" id="ep-out">—</div>`,
  script: `
var $=function(id){return document.getElementById(id);};
var WD=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
var MO=['January','February','March','April','May','June','July','August','September','October','November','December'];
function F(x){return Math.floor(x);}
function western(y){var g=y%19,c=F(y/100),
 h=(c-F(c/4)-F((8*c+13)/25)+19*g+15)%30,
 i=h-F(h/28)*(1-F(h/28)*F(29/(h+1))*F((21-g)/11)),
 j=(y+F(y/4)+i+2-c+F(c/4))%7,p=i-j;
 return {m:3+F((p+26)/30),d:1+(p+27+F((p+6)/40))%31,gold:g+1,epact:h};}
function orthodox(y){var g=y%19,
 i=(19*g+15)%30,j=(y+F(y/4)+i)%7,
 e=10;if(y>1600)e=e+F(y/100)-16-F((F(y/100)-16)/4);
 var p=i-j+e;
 return {m:3+F((p+26)/30),d:1+(p+27+F((p+6)/40))%31,off:e};}
function render(){var y=parseFloat($('ep-y').value);
 if(!(y>=1583&&y<=4099)){$('ep-out').innerHTML='<span class="tl-badge tl-no">check input</span> Years 1583 to 4099 (the Gregorian calendar\\u2019s range here).';return;}
 y=Math.floor(y);
 var W=western(y),O=orthodox(y);
 var dow=WD[(new Date(Date.UTC(y,W.m-1,W.d)).getUTCDay())];
 var same=(W.m===O.m&&W.d===O.d);
 var gap=Math.round((Date.UTC(y,O.m-1,O.d)-Date.UTC(y,W.m-1,W.d))/864e5);
 var html='<div class="tl-big">'+W.d+' '+MO[W.m-1]+' '+y+'</div>';
 html+='<p>Western Easter is a <b>'+dow+'</b>. Golden number <b>'+W.gold+'</b> (year '+W.gold+' of the 19-year Metonic cycle), paschal term <b>'+W.epact+'</b>.</p>';
 html+='<table class="tl-tab"><tbody>';
 html+='<tr><td>Orthodox Easter</td><td>'+O.d+' '+MO[O.m-1]+' '+y+' (same rule on the Julian calendar, +'+O.off+'-day conversion to the civil date)</td></tr>';
 html+='<tr><td>Gap this year</td><td>'+(same?'identical — it happens (2025 did, next 2028 and 2031)':gap+' days apart')+'</td></tr>';
 html+='<tr><td>Golden number</td><td>'+W.gold+' — metonic cycles realign the lunar calendar every 19 years (2026 \\u2194 2007 \\u2194 1988 pattern)</td></tr>';
 html+='<tr><td>Paschal term</td><td>'+W.epact+' — the epact-derived offset locating the ecclesiastical full moon</td></tr>';
 html+='</tbody></table><p class="meta">The computus defines an <i>ecclesiastical</i> full moon, not an astronomical one — which is why Easter can disagree with a real telescope by a day or two. The 1900s\\u20132000s Julian/Gregorian gap is 13 days; it grows to 14 in 2100.</p>';
 $('ep-out').innerHTML=html;}
$('ep-go').onclick=render;$('ep-y').oninput=render;render();`,
  seo: `<h2 class="section-title">A 1,300-year-old algorithm still shipping</h2>
  <p>The Council of Nicaea (325) delegated the date to the Church of Alexandria\\u2019s tables, and the arithmetic settled into the "Anonymous" computus by the 7th century — golden number from the 19-year Metonic cycle, an epact to shift the lunar age for solar-year drift, then "next Sunday after the paschal full moon". When the Gregorian reform rewrote the calendar in 1582 it fixed the solar year but kept the ecclesiastical moon, which is exactly why Western and Orthodox Easter now disagree: same rule, two calendars, a 13-day gap and different epact corrections. They do coincide (both calendars answered 20 April in 2025, and the next shared dates are 2028 and 2031) — but mostly the two Easters sit a week to over a month apart. The algorithm above is the same one the Book of Common Prayer\\u2019s margin directed parish priests to compute by hand.</p>`,
});

// ── 62. /alat/weekday — any date's weekday & date arithmetic ─────────────────
TOOLKIT.push({
  slug: 'weekday', ic: '📅', name: 'Weekday Finder',
  title: 'Weekday Finder — What Day Is Any Date, Plus Date Arithmetic | Tukuk-OS',
  desc: 'Name the weekday of any date from 1900 to 2200, see all the years a given month-day falls on a chosen weekday, and add or subtract days with the weekday carried along. In your browser.',
  hero: 'Weekday Finder', sub: 'any date → weekday · weekday-of-month years · +/- N days',
  navBlurb: 'What weekday is 14 March 2027? A calendar-correct answer for any date, plus every year your birthday lands on a Saturday.',
  hubBlurb: 'the weekday of any date, the years a date falls on a chosen weekday, and day-offset arithmetic that keeps the weekday',
  lead: 'One call to <b>Date.UTC</b> (which never touches your local timezone) gives the real weekday for any civil date. From there this page does the two party tricks: scanning years to find when a fixed date lands on a chosen weekday, and counting N days forward or backward while carrying the answer in both date and weekday form.',
  form: `<div class="tl-form">
  ${field('Date', '<input id="wd-d" type="date" value="2026-11-03">')}
  ${field('Offset (days, may be negative)', '<input id="wd-n" type="number" min="-36500" max="36500" step="1" value="100">')}
  ${field('Weekday to hunt for', '<select id="wd-hunt"><option value="0">Sunday</option><option value="1">Monday</option><option value="2" selected>Tuesday</option><option value="3">Wednesday</option><option value="4">Thursday</option><option value="5">Friday</option><option value="6">Saturday</option></select>')}
  <button class="tl-btn primary" id="wd-go" type="button">Find</button>
</div>
<div class="tl-res" id="wd-out">—</div>`,
  script: `
var $=function(id){return document.getElementById(id);};
var MON=['January','February','March','April','May','June','July','August','September','October','November','December'];
var WD=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
function leap(y){return (y%4===0&&y%100!==0)||y%400===0;}
function dim(y,m){return [31,leap(y)?29:28,31,30,31,30,31,31,30,31,30,31][m];}
function pd(s){var p=s.split('-');if(p.length!==3)return null;var y=+p[0],m=+p[1],d=+p[2];
 if(!(y>=1900&&y<=2200)||!(m>=1&&m<=12)||!(d>=1&&d<=dim(y,m-1)))return null;return{y:y,m:m,d:d};}
function mk(y,m,d){var m2=m-1;while(d>dim(y,m2)){d-=dim(y,m2);m2++;if(m2>11){m2=0;y++;}}
 while(d<1){m2--;if(m2<0){m2=11;y--;}d+=dim(y,m2);}return{y:y,m:m2+1,d:d};}
function dow(dt){return new Date(Date.UTC(dt.y,dt.m-1,dt.d)).getUTCDay();}
function f(dt){return dt.d+' '+MON[dt.m-1]+' '+dt.y;}
function render(){var dt=pd($('wd-d').value);
 if(!dt){$('wd-out').innerHTML='<span class="tl-badge tl-no">check input</span> A real date between 1900 and 2200.';return;}
 var n=parseInt($('wd-n').value,10);if(isNaN(n))n=0;
 var html='<div class="tl-big">'+WD[dow(dt)]+'</div>';
 html+='<p><b>'+f(dt)+'</b> \\u00b7 day '+((Date.UTC(dt.y,dt.m-1,dt.d)-Date.UTC(dt.y,0,1))/86400000+1)+' of '+dt.y+' \\u00b7 ISO week '+wk(dt)+'</p>';
 var off=Math.abs(n),dir=n<0?-1:1,rd=mk(dt.y,dt.m,dt.d+dir*off),sign=n<0?'\\u2212':'+';
 html+='<table class="tl-tab"><tbody>';
 html+='<tr><td>'+sign+off+' day'+(off===1?'':'s')+'</td><td><b>'+f(rd)+'</b> \\u2014 '+WD[dow(rd)]+' \\u2014 that is '+Math.round(off/7)+' week'+(Math.round(off/7)===1?'':'s')+' and '+(off%7)+' day'+(off%7===1?'':'s')+'</td></tr>';
 html+='</tbody></table>';
 var hunt=parseInt($('wd-hunt').value,10),found=[],yy=dt.y;
 while(found.length<5&&yy<=2200){if(dim(yy,dt.m-1)>=dt.d&&dow({y:yy,m:dt.m,d:dt.d})===hunt)found.push(yy);yy++;}
 html+='<p>Searching forward from '+dt.y+': <b>'+f(dt).replace(/\\d{4}$/,'')+'</b> next falls on a <b>'+WD[hunt]+'</b> in '+(found.length?found.slice(0,5).join(', '):'never within range')+'.</p>';
 html+='<p class="meta">Weekdays repeat on a 400-year Gregorian cycle (146,097 days is exactly 20,871 weeks), so a month-day can land on every weekday \\u2014 but not evenly: the 13th falls on a Friday more often than any other weekday (the famous Friday-the-13th skew, born from the 400-year pattern having 688 Fridays against 687 of the rest). Date.UTC is used deliberately: a local-time Date can shift a day across daylight saving.</p>';
 $('wd-out').innerHTML=html;}
function wk(dt){var t=Date.UTC(dt.y,dt.m-1,dt.d),day=(dow(dt)+6)%7;
 var thu=t+(4-day)*86400000,first=Date.UTC(new Date(thu).getUTCFullYear(),0,4);
 return Math.round((thu-first)/604800000)+1;}
$('wd-go').onclick=render;$('wd-d').oninput=render;$('wd-n').oninput=render;$('wd-hunt').onchange=render;render();`,
  seo: `<h2 class="section-title">How a weekday is computed at all</h2>
  <p>Under the surface this is Zeller's congruence: take the day, add the month and year offsets from a table, add the leap corrections, reduce modulo 7. The browser's <code>Date.UTC(...).getUTCDay()</code> is that arithmetic wearing a nicer hat, and using the UTC constructor matters — the local-time version can silently shift a date by a day across daylight-saving boundaries, which is exactly the bug that makes "what day is my birthday" apps wrong for some users. The ISO week number follows the Thursday rule: the week containing January 4 is always week 1.</p>`,
});

// ── 63. /alat/time-diff — days between dates, business days ──────────────────
TOOLKIT.push({
  slug: 'time-diff', ic: '⏳', name: 'Days Between Dates',
  title: 'Days Between Two Dates — Business Days, Weeks & Deadlines | Tukuk-OS',
  desc: 'Count days, weeks and months between any two dates, with and without weekends, in either counting convention — for deadlines, baby due dates, project windows and trip lengths.',
  hero: 'Days Between', sub: 'plain & business days · weeks+days · months+y-m-d · either convention',
  navBlurb: 'How many days until the deadline — plain, or weekends excluded, with the ISO week span and the y-m-d breakdown.',
  hubBlurb: 'days and business days between any two dates, in either counting convention, with weeks, months and the y-m-d form',
  lead: 'Deadline maths has one trap and four answers. The trap is <b>whether you count the start day</b> — project people say a task from Monday to Friday is 5 days, calendars say it is 4 nights away. This page prints both conventions, the exact difference (<i>n weeks, d days</i> and <i>y years, m months, d days</i>), and the weekday-free count with weekends removed by whole-week arithmetic rather than a loop.',
  form: `<div class="tl-form">
  ${field('From', '<input id="tf-a" type="date" value="2026-09-01">')}
  ${field('To', '<input id="tf-b" type="date" value="2026-11-03">')}
  ${field('Counting convention', '<select id="tf-conv"><option value="excl" selected>exclude the start day (4 nights)</option><option value="incl">include the start day (5 days)</option></select>')}
  <button class="tl-btn primary" id="tf-go" type="button">Count</button>
</div>
<div class="tl-res" id="tf-out">—</div>`,
  script: `
var $=function(id){return document.getElementById(id);};
var MON=['January','February','March','April','May','June','July','August','September','October','November','December'];
var WD=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
function leap(y){return (y%4===0&&y%100!==0)||y%400===0;}
function dim(y,m){return [31,leap(y)?29:28,31,30,31,30,31,31,30,31,30,31][m];}
function pd(s){var p=s.split('-');if(p.length!==3)return null;var y=+p[0],m=+p[1],d=+p[2];
 if(!(y>=1900&&y<=2200)||!(m>=1&&m<=12)||!(d>=1&&d<=dim(y,m-1)))return null;return{y:y,m:m,d:d};}
 function f(dt){return dt.d+' '+MON[dt.m-1]+' '+dt.y;}
function ms(dt){return Date.UTC(dt.y,dt.m-1,dt.d);}
function ymd(a,b){var y=b.y-a.y,m=b.m-a.m,d=b.d-a.d;
 if(d<0){m--;d+=dim(b.y,b.m-2);if(m<0){m=11;y--;}}
 return{y:y,m:m,d:d};}
function dow(dt){return new Date(ms(dt)).getUTCDay();}
function wd(a,b){var n=Math.round((ms(b)-ms(a))/86400000),s=0,k=0,day=dow(a);
 for(k=1;k<=n;k++){day=(day+1)%7;if(day===0||day===6)s++;}return s;}
function render(){var a=pd($('tf-a').value),b=pd($('tf-b').value);
 if(!a||!b){$('tf-out').innerHTML='<span class="tl-badge tl-no">check input</span> Two real dates (YYYY-MM-DD).';return;}
 var neg=ms(b)<ms(a);var lo=neg?b:a,hi=neg?a:b;
 var n=Math.round((ms(hi)-ms(lo))/86400000);
 var conv=$('tf-conv').value,cn=n+(conv==='incl'?1:0);
 var y=ymd(lo,hi),week=Math.floor(n/7),rd=n%7;
 var wknd=wd(lo,hi),bus=n-wknd;
 var html='<div class="tl-big">'+cn+' day'+(cn===1?'':'s')+(neg?' back':'')+'</div>';
 html+='<table class="tl-tab"><tbody>';
 html+='<tr><td>From</td><td>'+f(lo)+' \\u2014 '+WD[dow(lo)]+'</td></tr>';
 html+='<tr><td>To</td><td>'+f(hi)+' \\u2014 '+WD[dow(hi)]+'</td></tr>';
 html+='<tr><td>Exact difference</td><td>'+y.y+' years, '+y.m+' months, '+y.d+' days</td></tr>';
 html+='<tr><td>Weeks form</td><td>'+week+' week'+(week===1?'':'s')+' and '+rd+' day'+(rd===1?'':'s')+' \\u00b7 '+(n/7).toFixed(1).replace(/\\.0$/,'')+' weeks total</td></tr>';
 html+='<tr><td>Weekdays only</td><td><b>'+bus+' business days</b> ('+wknd+' weekend days skipped; public holidays not modelled)</td></tr>';
 html+='<tr><td>Other convention</td><td>'+(conv==='incl'?n+' days if you do not count the start day':n+1+' days if you count the start day')+'</td></tr>';
 html+='</tbody></table>';
 if(n===0)html+='<p><span class="tl-badge tl-ok">same day</span> Both dates are identical.</p>';
 else if(n<=14)html+='<p><span class="tl-badge tl-ok">close</span> '+(neg?'It passed ':'It is coming ')+n+' day'+(n===1?'':'s')+(neg?' ago':' away')+', on a '+WD[dow(hi)]+'.</p>';
 html+='<p class="meta">The y-m-d row uses calendar borrow (a negative day count borrows the previous month\\u2019s length); the weekday count walks real weekdays, so a range starting on a Saturday still gets its five working days. Business-day counts assume Sat/Sun off \\u2014 Malaysia\\u2019s official weekend varies by state (Johor, Kedah, Kelantan, Terengganu run Fri\\u2013Sat), and this page does not guess your holidays.</p>';
 $('tf-out').innerHTML=html;}
$('tf-go').onclick=render;$('tf-a').oninput=render;$('tf-b').oninput=render;$('tf-conv').onchange=render;render();`,
  seo: `<h2 class="section-title">Two conventions, one honest page</h2>
  <p>"Days between" means different things to different people: hotels count nights (arrive Monday, depart Friday = 4), project managers count working days on the calendar (Mon–Fri = 5), and legal deadlines usually count neither — they add N days to the trigger date and take the weekday that lands. The difference is exactly one at every boundary, which is why this page prints the excluded-start number as the headline and the included one beside it. The month breakdown exists because "63 days" is not how you tell someone their leave ends; "2 months and 2 days" is.</p>`,
});

// ── 64. /alat/unit-prefix — KB vs KiB, exact bytes ────────────────────────────
TOOLKIT.push({
  slug: 'unit-prefix', ic: '🗄️', name: 'KB vs KiB',
  title: 'KB vs KiB Converter — Exact Bytes for Every Storage Unit | Tukuk-OS',
  desc: 'Enter a size in KB, MB, GB, TB or their binary KiB/MiB/GiB/TiB twins and get the exact byte count (BigInt, no float rounding), both readings side by side, and the download time at a real bitrate.',
  hero: 'KB vs KiB', sub: 'exact bytes · decimal & binary rows · the 7% gap · Mbps honesty',
  navBlurb: 'The same file in decimal and binary units with the exact byte count — why 500 MB is 476.8 MiB, and why 100 Mbps is 12.5 MB/s.',
  hubBlurb: 'any storage size in exact bytes with both the decimal and binary readings — the KB/KiB gap, and megabits versus megabytes',
  lead: 'Two families of prefixes describe the same bytes: the <b>SI</b> one (kilo = 1,000) that drive makers and network meters use, and the <b>IEC binary</b> one (kibi = 1,024) that operating systems traditionally used. The gap compounds by roughly 7% per step — 1 GB versus 1 GiB is already 7% — which is the entire reason a "2 TB" drive shows as 1.81 TiB. This page computes in <b>BigInt</b> so a petabyte lands exact, prints both readings, and ends with the bitrate trap: networking is measured in <i>bits</i>, storage in <i>bytes</i>, and the factor of 8 is where "my 100 Mbps download only writes 12 MB/s" goes to die.',
  form: `<div class="tl-form">
  ${field('Value', '<input id="up-v" type="number" min="0" step="0.001" value="500">')}
  ${field('Unit', '<select id="up-u"><option value="B">bytes</option><option value="KB">KB (1,000)</option><option value="MB">MB (1,000²)</option><option value="GB">GB (1,000³)</option><option value="TB">TB (1,000⁴)</option><option value="PB">PB (1,000⁵)</option><option value="KiB">KiB (1,024)</option><option value="MiB">MiB (1,024²)</option><option value="GiB" selected>GiB (1,024³)</option><option value="TiB">TiB (1,024⁴)</option><option value="PiB">PiB (1,024⁵)</option></select>')}
  ${field('Download speed (Mbps, optional)', '<input id="up-mbps" type="number" min="0" max="100000" step="1" value="100">')}
  <button class="tl-btn primary" id="up-go" type="button">Convert</button>
</div>
<div class="tl-res" id="up-out">—</div>`,
  script: `
var $=function(id){return document.getElementById(id);};
var DEC=[['B',0n],['KB',1n],['MB',2n],['GB',3n],['TB',4n],['PB',5n]];
var BIN=[['B',0n],['KiB',1n],['MiB',2n],['GiB',3n],['TiB',4n],['PiB',5n]];
function pow10(k){var r=1n;for(var i=0n;i<k;i++)r*=10n;return r;}
function pow1024(k){var r=1n;for(var i=0n;i<k;i++)r*=1024n;return r;}
function scaled(v,bin,k){var parts=String(v).split('.');var dec=parts[1]||'';
 var num=BigInt((parts[0]+dec)||'0');var scale=10n**BigInt(dec.length);
 return {n:num*(bin?pow1024(k):pow10(k)),d:scale};}
function show(n,d){var whole=n/d,rem=n%d;if(rem===0n)return whole.toLocaleString('en-GB');
 var r=String(rem*10000n/d);while(r.length<4)r='0'+r;r=r.replace(/0+$/,'');
 return whole.toLocaleString('en-GB')+'.'+r;}
function render(){var v=$('up-v').value,u=$('up-u').value;
 if(!/^\\d*\\.?\\d+$/.test(v)){$('up-out').innerHTML='<span class="tl-badge tl-no">check input</span> A plain number.';return;}
 var bin=false,k=0,i;
 for(i=0;i<BIN.length;i++)if(BIN[i][0]===u){bin=true;k=i;}
 for(i=0;i<DEC.length;i++)if(DEC[i][0]===u){bin=false;k=i;}
 var sc=scaled(v,bin,BigInt(k));var bytes=sc.n,d=sc.d;
 if(bytes===0n){$('up-out').innerHTML='<span class="tl-badge tl-no">check input</span> Zero bytes has no interesting unit.';return;}
 var html='<div class="tl-big">'+show(bytes,d)+' bytes</div>';
 html+='<table class="tl-tab"><tbody><tr><td>Decimal (SI, per 1,000)</td><td>Binary (IEC, per 1,024)</td></tr>';
 for(i=0;i<5;i++){
  html+='<tr><td>'+show(bytes,pow10(BigInt(i)))+' '+(i===0?'B':DEC[i][0])+'</td><td>'+show(bytes,pow1024(BigInt(i)))+' '+(i===0?'B':BIN[i][0])+'</td></tr>';}
 html+='</tbody></table>';
 var mbps=parseFloat($('up-mbps').value);
 if(mbps>0){var secs=Number(bytes)/Number(d)/(mbps*1e6/8);
  var h2=Math.floor(secs/3600),m2=Math.floor(secs%3600/60),s3=Math.round(secs%60);
  html+='<p>At '+mbps+' Mbps ('+(mbps/8).toLocaleString('en-GB',{maximumFractionDigits:1})+' MB/s of true byte throughput) this file takes about '+(h2?h2+' h ':'')+(m2?m2+' min ':'')+s3+' s.</p>';}
 html+='<p class="meta">The two columns are the same bytes wearing two unit systems; the divergence compounds about 7% per step \u2014 GiB/GB \u2248 1.074, TiB/TB \u2248 1.10. Wi-Fi\u2019s real throughput is ~50-60% of the headline rate, so the transfer time above is a floor, not a promise. Byte maths here is BigInt end to end: a PiB is 2\u2075\u2070 = 1,125,899,906,842,624 bytes and not one float digit of it is rounded.</p>';
 $('up-out').innerHTML=html;}
$('up-go').onclick=render;$('up-v').oninput=render;$('up-u').onchange=render;$('up-mbps').oninput=render;render();`,
  seo: `<h2 class="section-title">Who uses which family, and when it bites</h2>
  <p>Drives, SSDs, USB sticks and data plans sell in powers of 1,000; Windows reports in powers of 1,024 (and calls them KB/MB anyway — the pre-1998 habit), macOS switched to SI in 10.6, and every firmware or RAM spec still lives in binary. The mismatch is why a "500 GB" disk shows as 465 GiB in Windows — nobody cheated you, the units changed under the number. Memory channels, page sizes and filesystem block counts are binary because address lines come two at a time (2¹⁰ = 1,024 ≈ 1,000 was the original approximation). The IEC names — kibi, mebi, gibi — were ratified in 1998 precisely to end the ambiguity, and lost the culture war except in standards documents like this page.</p>`,
});

// ── 65. /alat/pwstrength — password entropy, not a score ─────────────────────
TOOLKIT.push({
  slug: 'pwstrength', ic: '🔐', name: 'Password Strength',
  title: 'Password Strength Checker — Entropy Bits & Crack Time | Tukuk-OS',
  desc: 'Estimate a password\'s real strength: character-class entropy, penalty for common passwords and keyboard runs, and crack time against an offline attacker at 10 billion guesses per second. Nothing is sent anywhere.',
  hero: 'Password Entropy', sub: 'bits of entropy · class pool · run/repeat penalty · 10¹⁰ guesses/s',
  navBlurb: 'Entropy bits instead of a coloured bar: the character pool, the dictionary and-pattern penalties, and what a GPU cracking rig needs.',
  hubBlurb: 'a password\'s entropy in bits with the common-password and keyboard-run penalties, and an honest offline-crack time',
  lead: 'A strength <b>bar</b> is theatre; entropy in <b>bits</b> is arithmetic. The pool is the number of characters your set allows (26 lower, 62 mixed case, 95 printable, plus emoji if you like), the raw entropy is length × log₂(pool), and the discounts are what attackers actually exploit: a dictionary word contributes almost nothing, a keyboard run ("qwerty") almost nothing, a doubled word almost nothing. Crack time assumes an <b>offline</b> attacker with a rig doing 10¹⁰ guesses/second (the ballpark for bcrypt-fast GPU farms on an unsalted hash) — half the entropy-space on average, so divide by two.',
  form: `<div class="tl-form">
  ${field('Password to test (typed nowhere but this page)', '<input id="ps-in" type="text" value="Corr3ct-Horse!2026" autocomplete="off" spellcheck="false">')}
  <button class="tl-btn primary" id="ps-go" type="button">Measure</button>
</div>
<div class="tl-res" id="ps-out">—</div>`,
  script: `
var $=function(id){return document.getElementById(id);};
var COMMON=['password','123456','123456789','qwerty','abc123','letmein','monkey','dragon','sunshine','princess','football','iloveyou','admin','welcome','login','passw0rd','shadow','1234567','12345678','trustno1','starwars','pass','test','guest','zaq12wsx','michael','jennifer','jordan','harley','ranger','buster','soccer','hockey','killer','cheese','banana','purple','asdfgh','asdf1234','111111','000000','password1','passw0rd1','hunter2'];
var SEQW='abcdefghijklmnopqrstuvwxyz';var SEQN='0123456789';var KBD=['qwertyuiop','asdfghjkl','zxcvbnm','1234567890','qazwsx','edcrfv'];
function pool(s){var p=0;if(/[a-z]/.test(s))p+=26;if(/[A-Z]/.test(s))p+=26;if(/[0-9]/.test(s))p+=10;if(/[^a-zA-Z0-9]/.test(s))p+=33;return p;}
function hasRun(s){var l=s.toLowerCase(),i,j;
 for(i=0;i<=l.length-4;i++){var t=l.substr(i,4),ok=false;
  for(j=0;j<KBD.length;j++)if(KBD[j].indexOf(t)!==-1||t.split('').reverse().join('')&&KBD[j].indexOf(t.split('').reverse().join(''))!==-1)ok=true;
  for(j=0;j<SEQW.length-3;j++)if(SEQW.substr(j,4)===t)ok=true;
  for(j=0;j<SEQN.length-3;j++)if(SEQN.substr(j,4)===t)ok=true;
  if(ok)return t;}
 return null;}
function human(bits){var g=Math.pow(2,bits)/2;var secs=g/1e10;
 var u=[['seconds',1],['minutes',60],['hours',3600],['days',86400],['years',31557600],['centuries',3155760000]];
 for(var i=u.length-1;i>=1;i--)if(secs>=u[i][1])return (secs/u[i][1]).toFixed(secs/u[i][1]>=100?0:2)+' '+u[i][0];
 return secs.toFixed(secs<1?3:1)+' seconds';}
function render(){var s=$('ps-in').value;
 if(!s){$('ps-out').innerHTML='<span class="tl-badge tl-no">check input</span> Type a password to measure. It never leaves the page \\u2014 there is no network call to make.';return;}
 var low=s.toLowerCase(),bits,note='';
 var inCommon=COMMON.indexOf(low)!==-1;
 var p=pool(s),raw=s.length*Math.log(p||1)/Math.LN2;
 if(inCommon){bits=Math.log(445e3)/Math.LN2;note='<span class="tl-badge tl-no">in every leak corpus</span> A dictionary hit: rule engines try these first, so its entropy is that of picking one of ~445,000 leaked words \u2014 about 19 bits, no matter how long it is.';
 }else{
  bits=raw;
  var rep=/^(.+)\\1+$/.test(s);if(rep){bits-=Math.log(s.length)/Math.LN2;note+='Repeated pattern \\u2014 the repeat is free to an attacker. ';}
  var run=hasRun(s);if(run){bits-=16;note+='Keyboard/sequence run "'+run+'" \\u2014 discounted 16 bits. ';}
  var digitTail=/^\\D+\\d{1,4}$/.test(s);if(digitTail){bits-=8;note+='Digits tacked on the end \u2014 attackers try those templates first, so minus 8 bits. ';}}
 bits=Math.max(0,bits);
 var badge=bits<28?['tl-no','trivially crackable']:bits<40?['tl-no','weak']:bits<60?['tl-ok','okay for online']:bits<80?['tl-ok','strong']:['tl-ok','excellent'];
 var html='<div class="tl-big">'+Math.round(bits)+' bits</div>';
 html+='<p><span class="tl-badge '+badge[0]+'">'+badge[1]+'</span> Against an offline rig at 10¹⁰ guesses/s: about <b>'+human(bits)+'</b> on average.</p>';
 html+='<table class="tl-tab"><tbody>';
 html+='<tr><td>Length</td><td>'+s.length+' characters</td></tr>';
 html+='<tr><td>Character pool</td><td>'+p+' symbols \\u2192 log₂('+p+') = '+(Math.log(p)/Math.LN2).toFixed(2)+' bits per character</td></tr>';
 html+='<tr><td>Raw entropy</td><td>'+raw.toFixed(1)+' bits</td></tr>';
 html+='<tr><td>After penalties</td><td><b>'+bits.toFixed(1)+' bits</b>'+(note?' \\u2014 '+note:'')+'</td></tr>';
 html+='</tbody></table>';
 html+='<p class="meta">Where the numbers come from: 40 bits is crackable in days by a serious GPU rig; 60 bits is a nation-state nuisance; 80+ is safe until quantum brute-forcing changes the game, and nothing changes that the <b>length</b> term beats the <b>symbol soup</b> term — four random words (≈ 4×11 bits from a 4096-word dict each... realistically 45 bits) beat "P@ssw0rd!" (which is 6). The honest bar for real humans: a unique passphrase of five random words, plus the site using two-factor.</p>';
 $('ps-out').innerHTML=html;}
$('ps-go').onclick=render;$('ps-in').oninput=render;render();`,
  seo: `<h2 class="section-title">How password lists actually get cracked</h2>
  <p>No attacker tries character-by-character. Rule engines (Hashcat, John) apply mutations to the million-password leak corpora that are already public — append digits, capitalise, leet-swap, double the word — which is why "Corr3ct-H0rse!" scores far below its raw entropy. The effective strength of a password is its rank in a human-behaviour distribution, not its length times its pool; this page approximates that with the three penalties every corpus study finds (dictionary membership, runs/patterns, template endings). The counterweight is random words from a diceware-style choice, where the entropy really is log₂(dictsize) per word because no human skill is involved in the picking — and where a 20-character password is easy to type, remember and read back over the phone.</p>`,
});

// ── 66. /alat/repeating — decimal expansion & repeating cycle ────────────────
TOOLKIT.push({
  slug: 'repeating', ic: '🔁', name: 'Repeating Decimal',
  title: 'Repeating Decimal Finder — Long Division With the Cycle Marked | Tukuk-OS',
  desc: 'Divide any two integers and see the exact decimal: terminating digits, the repeating cycle in parentheses with its length, the remainders that prove it, and the fraction reduced first.',
  hero: 'Repeating Decimal', sub: '1/7 = 0.(142857) · cycle length · remainder proof · reduced form',
  navBlurb: 'See the infinite inside a fraction: the long-division expansion with the repeating cycle marked, its length, and the remainder trail that proves it must repeat.',
  hubBlurb: 'any fraction expanded to its exact repeating decimal with the cycle length and the remainder proof, BigInt-exact',
  lead: 'A decimal either <b>terminates</b> or <b>repeats</b> — there is no third option, and the proof fits in one page of long division. Remainders are integers between 0 and the divisor, so after at most d−1 steps one must appear twice, and the digits between the two sightings are the cycle. This page runs the division in BigInt (so 1/97 comes out exact, not float-rounded), marks the cycle, reports its length, and shows the remainder trail so you can <i>see</i> the pigeonhole working.',
  form: `<div class="tl-form">
  ${field('Numerator', '<input id="rp-a" type="number" step="1" value="1">')}
  ${field('Denominator', '<input id="rp-b" type="number" step="1" value="7">')}
  <button class="tl-btn primary" id="rp-go" type="button">Expand</button>
</div>
<div class="tl-res" id="rp-out">—</div>`,
  script: `
var $=function(id){return document.getElementById(id);};
function gcd(a,b){while(b){var t=a%b;a=b;b=t;}return a;}
function render(){var a=parseInt($('rp-a').value,10),b=parseInt($('rp-b').value,10);
 if(isNaN(a)||isNaN(b)||b===0||Math.abs(b)>1000000||Math.abs(a)>1000000){$('rp-out').innerHTML='<span class="tl-badge tl-no">check input</span> Two integers, denominator not 0, both within \\u00b11,000,000.';return;}
 var neg=(a<0)!==(b<0);a=Math.abs(a);b=Math.abs(b);
 var g=gcd(a,b),an=a/g,bn=b/g;
 var whole=Math.floor(an/bn),rem=BigInt(an%bn),B=BigInt(bn);
 var digits=[],seen={},pos=0,cycleAt=-1,trail=[];
 while(rem!==0n){if(seen[rem]!==undefined){cycleAt=seen[rem];break;}
  seen[rem]=pos;var num=rem*10n;var dg=Number(num/B);digits.push(dg);
  trail.push(String(num)+' \\u00f7 '+bn+' = '+dg+' r '+(num%B));rem=num%B;pos++;}
 var pre=neg?'-':'';
 var html;
 if(rem===0n){var dec=digits.join('');
  html='<div class="tl-big">'+pre+whole+(dec?'.'+dec:'')+'</div>';
 }else{
  var cyc=digits.slice(cycleAt).join('');
  html='<div class="tl-big">'+pre+whole+'.'+digits.slice(0,cycleAt).join('')+'<span style="text-decoration:overline">'+cyc+'</span></div>';
 }
 if(rem!==0n){
  html+='<p>Cycle length <b>'+(digits.length-cycleAt)+'</b>'+(cycleAt>0?', after '+cycleAt+' non-repeating '+(cycleAt===1?'digit':'digits'):'')+' \\u00b7 exact value '+pre+whole+'.'+digits.slice(0,cycleAt).join('')+'('+digits.slice(cycleAt).join('')+')</p>';
 }else{
  html+='<p><span class="tl-badge tl-ok">terminates</span> '+a+'/'+b+' = '+an+'/'+bn+(bn===1?' is a whole number.':' ends after '+digits.length+' '+(digits.length===1?'digit':'digits')+' because '+bn+' divides a power of 10.')+'</p>';
 }
 html+='<table class="tl-tab"><tbody>';
 html+='<tr><td>Reduced fraction</td><td>'+a+'/'+b+' = '+an+'/'+bn+' (gcd '+g+')</td></tr>';
 if(rem!==0n)html+='<tr><td>Why it repeats</td><td>remainders are integers in 1 to '+(bn-1)+', so after at most '+(bn-1)+' steps the pigeonhole principle forces a repeat \\u2014 the digits between two identical remainders loop forever.</td></tr>';
 var f2=BigInt(bn);while(f2%2n===0n)f2/=2n;while(f2%5n===0n)f2/=5n;
 html+='<tr><td>Terminating test</td><td>a fraction terminates exactly when its reduced denominator has no prime factors except 2 and 5; after stripping those from '+bn+', '+(f2===1n?'nothing remains \\u2014 which is why it ends':', which leaves '+f2+', which is why it loops')+'.</td></tr>';
 html+='</tbody></table>';
 var steps=[];for(var i=0;i<Math.min(trail.length,12);i++)steps.push(trail[i]);
 html+='<p class="meta">First remainder steps: '+(steps.length?steps.join(' \\u00b7 '):'none \\u2014 whole number')+'. For a prime denominator like '+bn+', the cycle length divides \\u03c6('+bn+')='+(bn-1)+': 1/7 runs the full 6-digit reptend 142857, while 1/3 and 1/11 cycle in a single digit. The numerator only rotates the same cycle \\u2014 2/7 is 285714, the same six digits shifted.</p>';
 $('rp-out').innerHTML=html;}
$('rp-go').onclick=render;$('rp-a').oninput=render;$('rp-b').oninput=render;render();`,
  seo: `<h2 class="section-title">The pigeonhole principle, sold as arithmetic</h2>
  <p>Long division on a remainder that has appeared before must produce the same digit and the same next remainder as the first time — the loop is forced, not observed. That single fact gives every property above: cycles of length at most d−1, the 2-and-5 terminating rule (those factors are exactly the ones that can be "absorbed" by multiplying the remainder by 10 until it is coprime), and the reason 1/7 and 2/7 are the same six digits rotated: the cycle is a property of the denominator, and the numerator only chooses the starting point inside it.</p>`,
});

// ── 67. /alat/kbd — keyboard tester ──────────────────────────────────────────
TOOLKIT.push({
  slug: 'kbd', ic: '⌨️', name: 'Keyboard Test',
  title: 'Keyboard Tester — Press Every Key, See Every Register | Tukuk-OS',
  desc: 'A live keyboard health check: press any key and watch its chip light up, with the code, the keydown/keyup state, and a completeness count. Runs offline in the browser — useful for loaner laptops and dead switches.',
  hero: 'Keyboard Test', sub: 'live keydown map · codes & states · completeness counter · offline',
  navBlurb: 'Press every key and see every register — the two-minute health check for a secondhand laptop, a borrowed keyboard or a suspect switch.',
  hubBlurb: 'a live keyboard test with key codes, pressed state and a completeness counter for checking every switch works',
  lead: 'The browser reports three useful things per keystroke: <b>event.key</b> (what was typed, layout-aware), <b>event.code</b> (which physical switch went down, layout-blind — <code>KeyA</code> is the same key on AZERTY and QWERTY), and the <b>repeat</b> flag, which tells held keys from machine-gun chattering switches. A failing keyboard usually fails in exactly one of these streams: a dead switch sends nothing, a chattering switch sends repeated keydowns without keyup, and a stuck key shows as a code that never leaves the pressed set.',
  form: `<div class="tl-form">
  <p class="meta">Click anywhere on this page first, then press keys. Chips light while a key is held and stay green once tested. <button class="tl-btn" id="kb-rs" type="button" style="margin-left:8px">Reset</button></p>
  <div id="kb-grid"></div>
</div>
<div class="tl-res" id="kb-out">—</div>`,
  css: `
.kb-key{display:inline-block;min-width:34px;padding:6px 8px;margin:2px;border-radius:6px;background:#e3e6ec;border:1px solid #c9cfda;text-align:center;font-size:.78rem;cursor:default;transition:transform .06s}
.kb-key.kb-hit{background:#d1f5dd;border-color:#11753a}
.kb-key.kb-down{background:#6366f1;border-color:#4f46a8;color:#fff;transform:translateY(2px)}
.kb-sub{display:block;font-size:.62rem;opacity:.65}
.kb-space{min-width:240px}`,
  script: `
var $=function(id){return document.getElementById(id);};
var ROWS=[['Esc','F1','F2','F3','F4','F5','F6','F7','F8','F9','F10','F11','F12'],['\u0060','1','2','3','4','5','6','7','8','9','0','-','=','Backspace'],['Tab','q','w','e','r','t','y','u','i','o','p','[',']','\\\\'],['CapsLock','a','s','d','f','g','h','j','k','l',';','Enter'],['Shift','z','x','c','v','b','n','m',',','.','/','Shift'],['Control','Meta','Alt',' ','Alt','Meta','Menu','Control']];
var down={},tested={},POS={};
(function(){for(var r=0;r<ROWS.length;r++)for(var c=0;c<ROWS[r].length;c++)POS[ROWS[r][c]]=1;})();
var TOTAL=Object.keys(POS).length;
function norm(k){if(k===' ')return ' ';if(k&&k.length===1)return k.toLowerCase();return k;}
function clsFor(L){return 'kb-key'+(L===' '?' kb-space':'')+(down[L]?' kb-down':tested[L]?' kb-hit':'');}
function nameOf(L){return L===' '?'space':L==='\\\\'?'backslash':L;}
function grid(){var h='';for(var r=0;r<ROWS.length;r++){for(var c=0;c<ROWS[r].length;c++){var L=ROWS[r][c];
 h+='<span class="'+clsFor(L)+'">'+nameOf(L)+'</span>';}h+='<br>';}
 $('kb-grid').innerHTML=h;}
function status(){var hit=0,k,miss=[];
 for(k in POS){if(tested[k])hit++;else miss.push(nameOf(k));}
 var h='<div class="tl-big">'+hit+' / '+TOTAL+' tested</div>'+
  '<p>Keys lit: '+hit+' of '+TOTAL+' positions. '+(hit===TOTAL?'<span class="tl-badge tl-ok">all good</span> Every mapped position has registered at least once.':'<span class="tl-badge tl-no">missing</span> Untried: '+miss.slice(0,14).join(', ')+(miss.length>14?' \u2026':'')+'.</p>');
 var held=Object.keys(down);if(held.length)h+='<p class="meta">Currently held: '+held.map(nameOf).join(' + ')+'. If one of these is not physically pressed, that switch is stuck.</p>';
 $('kb-out').innerHTML=h;grid();}
document.onkeydown=function(e){var L=norm(e.key);if(!POS[L])return;
 if(e.preventDefault)e.preventDefault();down[L]=1;grid();};
document.onkeyup=function(e){var L=norm(e.key);if(!POS[L])return;delete down[L];tested[L]=1;status();};
$('kb-rs').onclick=function(){down={};tested={};status();};
status();`,
  seo: `<h2 class="section-title">What the test can and cannot catch</h2>
  <p>A browser test sees the key events your operating system delivers, which is enough to find dead switches, stuck keys and double-triggering (a chattering contact fires keydown twice before keyup — watch the held list). It cannot test keys the OS grabs before the page sees them (Fn combos, system media keys, some firmware macros), and laptop Fn layers usually remap underneath, which is why <code>code</code> is the layout-blind half of the report. For a serious used-laptop inspection, press every chip here, then also open a text editor and type the whole home row — belt and braces.</p>`,
});

// ── 68. /alat/pomodoro — focus timer ─────────────────────────────────────────
TOOLKIT.push({
  slug: 'pomodoro', ic: '🍅', name: 'Pomodoro Timer',
  title: 'Pomodoro Timer — 25/5 Focus Cycles With Long Breaks | Tukuk-OS',
  desc: 'A classic Cirillo pomodoro: work blocks, short breaks, a long break every fourth session — the countdown kept as an end timestamp so a throttled background tab cannot steal minutes. No install, in your browser.',
  hero: 'Pomodoro Timer', sub: '25 work · 5 break · long break every 4 · Date.now clock',
  navBlurb: 'Run proper pomodoro sessions — 25 minutes of work, 5 of rest, a long break every fourth — with the countdown kept on the system clock, so a throttled tab loses nothing.',
  hubBlurb: 'a pomodoro focus timer with work, short and long phases and a session tally, clocked from Date.now so throttling cannot drift it',
  lead: 'Francesco Cirillo picked 25 minutes in the late 1980s for the boring, correct reason: a kitchen timer that size fits a task you can start when you do not feel like starting anything. The technique is the cycle — <b>work, short break, a long break after every fourth pomodoro</b>. This page keeps the countdown as an <b>end timestamp compared against Date.now()</b>, not a counter that decrements: browsers throttle background timers to roughly one tick per second, but a timestamp survives any throttle, so leaving the tab cannot make a 25-minute block silently become 25 minutes and 40 seconds.',
  form: `<div class="tl-form">
  <div class="pm-wrap"><span class="pm-clock" id="pm-clock">25:00</span><div class="meta" id="pm-phase">ready</div></div>
  ${field('Work (minutes)', '<input id="pm-work" type="number" min="5" max="60" step="1" value="25">')}
  ${field('Short break', '<input id="pm-short" type="number" min="1" max="15" step="1" value="5">')}
  ${field('Long break', '<input id="pm-long" type="number" min="10" max="45" step="1" value="15">')}
  ${field('Pomodoros until long break', '<input id="pm-cycle" type="number" min="2" max="8" step="1" value="4">')}
  <button class="tl-btn primary" id="pm-go" type="button">▶ Start</button>
  <button class="tl-btn" id="pm-rs" type="button">Reset</button>
</div>
<div class="tl-res" id="pm-out">—</div>`,
  css: `
.pm-wrap{text-align:center;padding:12px 0}
.pm-clock{font-size:3rem;font-weight:700;letter-spacing:.06em}`,
  script: `
var $=function(id){return document.getElementById(id);};
var NAMES={work:'Work',short:'Short break',long:'Long break'};
var TITLE=document.title,st={run:false,end:0,rest:0,phase:'work',done:0},T=null,AC=null;
function mins(k){var v=parseFloat($(k).value);if(isNaN(v))v=25;return Math.max(30000,v*60000);}
function len(){return st.phase==='work'?mins('pm-work'):st.phase==='short'?mins('pm-short'):mins('pm-long');}
function fmt(ms){var s=Math.max(0,Math.ceil(ms/1000)),m=Math.floor(s/60);s=s%60;return (m<10?'0':'')+m+':'+(s<10?'0':'')+s;}
function left(){return st.run?st.end-Date.now():st.rest;}
function chime(n){try{var W=window.AudioContext||window.webkitAudioContext;if(!W)return;if(!AC)AC=new W();var i=0;
 (function ring(){if(i>=n)return;var o=AC.createOscillator(),g=AC.createGain();o.type='sine';
  o.frequency.value=i%2?660:880;
  g.gain.setValueAtTime(0.0001,AC.currentTime);g.gain.exponentialRampToValueAtTime(0.5,AC.currentTime+0.02);
  g.gain.exponentialRampToValueAtTime(0.0001,AC.currentTime+0.4);
  o.connect(g);g.connect(AC.destination);o.start(AC.currentTime);o.stop(AC.currentTime+0.45);
  i++;setTimeout(ring,560);})();}catch(e){}}
function paint(){var l=left();$('pm-clock').textContent=fmt(l);
 $('pm-phase').textContent=NAMES[st.phase]+(st.run?' \\u00b7 running':st.rest>0?' \\u00b7 paused':' \\u00b7 ready')+' \\u00b7 '+st.done+' done';
 if(st.run)document.title=fmt(l)+' \\u2014 '+NAMES[st.phase];}
function summary(){var w=parseInt($('pm-work').value,10)||25;
 var h='<div class="tl-big">'+st.done+' pomodoro'+(st.done===1?'':'s')+' \\u00b7 '+(st.done*w)+' focused minutes</div>';
 h+='<table class="tl-tab"><tbody><tr><td>Plan</td><td>'+$('pm-work').value+' work / '+$('pm-short').value+' short / '+$('pm-long').value+' long, long break every '+$('pm-cycle').value+'</td></tr>';
 h+='<tr><td>Clock</td><td>end-timestamp vs Date.now \\u2014 a backgrounded or throttled tab cannot drift the block</td></tr></tbody></table>';
 h+='<p class="meta">Cirillo\\u2019s own rules: a pomodoro is indivisible (interrupted means it does not count), breaks are for water, standing and windows \\u2014 not for the next task, and the long break earns its length by the fourth, when the fourth 25 minutes would otherwise be the worst of the day. Ultradian research suggests natural cycles nearer 50\\u201390 minutes, which is exactly why every field above is editable.</p>';
 $('pm-out').innerHTML=h;}
function advance(){
 if(st.phase==='work'){st.done++;chime(Math.min(st.done,4));
  var every=parseInt($('pm-cycle').value,10)||4;
  st.phase=(st.done%every===0)?'long':'short';}
 else{st.phase='work';chime(1);}}
function tick(){if(!st.run)return;
 if(Date.now()>=st.end){advance();st.end=Date.now()+len();}
 paint();}
function go(){if(st.run){st.run=false;if(T)clearInterval(T);T=null;st.rest=Math.max(0,st.end-Date.now());$('pm-go').textContent='\\u25b6 Resume';document.title=TITLE;}
 else{if(st.rest<=0)st.rest=len();st.end=Date.now()+st.rest;st.rest=0;st.run=true;T=setInterval(tick,250);$('pm-go').textContent='Pause';}
 paint();}
function rs(){if(T)clearInterval(T);T=null;st.run=false;st.phase='work';st.done=0;st.rest=len();
 $('pm-go').textContent='\\u25b6 Start';document.title=TITLE;paint();summary();}
$('pm-go').onclick=go;$('pm-rs').onclick=rs;
['pm-work','pm-short','pm-long','pm-cycle'].forEach(function(k){$(k).oninput=function(){if(!st.run)st.rest=len();paint();};});
rs();`,
  seo: `<h2 class="section-title">Why the timer is a timestamp, not a countdown</h2>
  <p>A counter that subtracts one every 250 ms loses accuracy the moment the browser puts the tab to sleep: background timers are throttled to roughly one tick a second in most engines, and a frozen tab may receive nothing at all until it is focused again. Store the end instant instead and the worst case becomes a display that updates late, never a minute that goes missing — the same reason the lap stopwatch above works and a naïve countdown app does not. As for 25 itself: it is a convention, not a finding. The measured ultradian rhythm is nearer 90 minutes, and novices do better with short cycles they actually finish than with long ones they abandon — which is the honest argument for keeping the defaults and editing them only when a whole day of pomodoros says otherwise.</p>`,
});

// ── 69. /alat/reading-time — words to minutes ────────────────────────────────
TOOLKIT.push({
  slug: 'reading-time', ic: '📖', name: 'Reading Time',
  title: 'Reading Time Calculator — Words to Minutes at Real Speeds | Tukuk-OS',
  desc: 'Paste an article and get an honest reading time: words counted the way a word processor counts them, with minutes at measured silent, read-aloud and narration speeds. Nothing is uploaded.',
  hero: 'Reading Time', sub: 'words counted locally · 238 / 160 / 130 wpm · zero upload',
  navBlurb: 'Count a text the way a word processor does and quote the reading time that matches the claim — average silent reading, reading aloud, or a recorded narration, all from research speeds.',
  hubBlurb: 'a reading-time estimator that counts words locally and prices them at the measured 238, 160 and 130 words-per-minute speeds',
  lead: 'Blog widgets set reading time by dividing words by 200 and rounding up; the research says something more specific. Brysbaert\u2019s 2019 synthesis of 190 studies puts the average adult at about <b>238 words per minute reading silently</b> in English, while <b>reading aloud to someone runs near 150</b> and a prepared spoken presentation closer to <b>130</b> — audiobook narration sits around 160. This page counts words the way a word processor does (trim, then split on whitespace) and prices the same text at every speed, so you can quote the number that matches the claim you are making.',
  form: `<div class="tl-form">
  <textarea id="rt-in" rows="8" spellcheck="false">The first drafts of this page were timed by hand, which turned out to be the wrong experiment entirely. Reading a printed page and reading a screen are different physical acts: on a screen the eyes saccade in an F pattern, scrolling replaces the return sweep, and most visitors skim before they commit. So a published reading time is not a promise about how long someone will spend; it is a promise about how long the text is if someone reads every word in order. That is still useful information — it tells the writer when a piece has outgrown its argument, and it tells the reader whether the next ten minutes are worth starting. The numbers below come from large-scale timing studies rather than folklore, and they disagree with the round estimates most tools print by a margin that matters once a text passes a thousand words.</textarea>
  ${field('Your speed', '<select id="rt-wpm"><option value="238" selected>238 wpm — average silent reading</option><option value="200">200 wpm — the blogging convention</option><option value="160">160 wpm — audiobook narration</option><option value="150">150 wpm — reading aloud</option><option value="130">130 wpm — spoken presentation</option></select>')}
</div>
<div class="tl-res" id="rt-out">—</div>`,
  script: `
var $=function(id){return document.getElementById(id);};
var SPEEDS=[[238,'Average silent reading (Brysbaert 2019)'],[200,'The blogging convention'],[160,'Audiobook narration'],[150,'Reading aloud to someone'],[130,'A measured spoken presentation']];
function c(){var t=$('rt-in').value.replace(/\\r/g,'').trim();
 if(!t)return{w:0,ch:0,s:0,p:0};
 var w=t.split(/\\s+/).length,ch=t.length;
 var s=(t.match(/[.!?]+(?:\\s|$)/g)||[]).length||1;
 var p=t.split(/\\n{2,}/).length;return{w:w,ch:ch,s:s,p:p};}
function fm(min){if(min<=0)return '0 seconds';if(min<1)return Math.max(1,Math.round(min*60))+' seconds';
 var m=Math.floor(min),sec=Math.round((min-m)*60);return m+' min'+(sec?' '+sec+' s':'');}
function render(){var x=c(),sel=parseInt($('rt-wpm').value,10)||238;
 var h='<div class="tl-big">'+fm(x.w/sel)+'</div>';
 h+='<table class="tl-tab"><tbody><tr><td>Words</td><td>'+x.w+'</td></tr>';
 h+='<tr><td>Characters (with spaces)</td><td>'+x.ch+'</td></tr>';
 h+='<tr><td>Sentences</td><td>'+x.s+'</td></tr>';
 h+='<tr><td>Average sentence</td><td>'+(x.w&&x.s?(x.w/x.s).toFixed(1)+' words':'\\u2014')+'</td></tr>';
 h+='<tr><td>Paragraphs</td><td>'+x.p+'</td></tr></tbody></table>';
 h+='<table class="tl-tab"><tbody><tr><td>Assumption</td><td>Minutes</td></tr>';
 SPEEDS.forEach(function(sp){h+='<tr><td>'+sp[1]+' \\u2014 '+sp[0]+' wpm</td><td>'+fm(x.w/sp[0])+(sp[0]===sel?' \\u2190 chosen':'')+'</td></tr>';});
 h+='</tbody></table>';
 h+='<p class="meta">Words follow the whitespace convention: contractions count once, a URL counts once, and a 500-word page costs a skimming reader far less than any line above \\u2014 these are times for linear reading, which almost nobody does on a screen. The F-pattern eye-tracking literature is unanimous that the first two paragraphs do most of the work.</p>';
 $('rt-out').innerHTML=h;}
$('rt-in').oninput=render;$('rt-wpm').onchange=render;render();`,
  seo: `<h2 class="section-title">Why published reading times overstate and understate at once</h2>
  <p>They overstate what a screen reader actually spends \u2014 visitors skim, bounce mid-list and scroll past the middle of long paragraphs, so the time on page for a "5-minute" article is routinely half that. And they understate what the same article costs a careful reader: the 238 wpm average is measured on continuous prose without headings, code blocks, tables or links pulling the eye; add any structure and the true linear time stretches, because attention costs are not in the word count. The honest use of a reading time is comparative \u2014 "this is twice as long as the last one" \u2014 not predictive. If a number must be predictive, the study-speed line (150\u2013160 wpm) is the one that survives when the text contains anything a reader has to think about.</p>`,
});

// ── 70. /alat/ean13 — EAN-13 barcode generator ───────────────────────────────
TOOLKIT.push({
  slug: 'ean13', ic: '🏷️', name: 'EAN-13 Barcode',
  title: 'EAN-13 Barcode Generator — Check Digit and Bars in Your Browser | Tukuk-OS',
  desc: 'Type 12 digits, get the computed modulo-10 check digit and a crisp EAN-13 drawn on canvas with the human-readable digits — parity tables and weighting shown, zero uploads, zero libraries.',
  hero: 'EAN-13 Barcode', sub: '12 digits → check digit · canvas bars · parity tables explained',
  navBlurb: 'Generate real EAN-13 barcodes from 12 digits — the check digit computed with the official 1,3 weights and the bars drawn straight onto a canvas, with the encoding table on the page.',
  hubBlurb: 'an EAN-13 barcode generator with the modulo-10 check digit, the first-digit parity encoding and a canvas drawing you can print at 2 px per module',
  lead: 'An EAN-13 is 95 modules of bars encoding 13 digits, but only 12 are ever typed: the thirteenth is a <b>modulo-10 check digit</b> weighted 1,3,1,3… from the left, so a single mistyped digit or a transposed adjacent pair changes the weighted sum and every scanner rejects the code. The first digit is never drawn as bars — it hides in the <b>parity pattern</b> of the left half (which of its six digits use the mirrored G pattern instead of L), which is what lets the same six digits encode two different ways and lets a reader tell an upside-down barcode from a right-way-up one. This page computes the check digit, builds the module string from the published tables and paints it directly on a canvas.',
  form: `<div class="tl-form">
  ${field('12 digits (or full 13)', '<input id="ea-in" type="text" inputmode="numeric" maxlength="13" value="590123412345" size="16">')}
  <button class="tl-btn primary" id="ea-go" type="button">Draw</button>
  <button class="tl-btn" id="ea-rnd" type="button">Random test code</button>
  <div style="background:#fff;display:inline-block;padding:8px;margin-top:10px"><canvas id="ea-cv" width="205" height="122"></canvas></div>
</div>
<div class="tl-res" id="ea-out">—</div>`,
  script: `
var $=function(id){return document.getElementById(id);};
var R=['1110010','1100110','1101100','1000010','1011100','1001110','1010000','1000100','1001000','1110100'];
function comp(s){var o='',i;for(i=0;i<s.length;i++)o+=s.charAt(i)==='0'?'1':'0';return o;}
function rev(s){return s.split('').reverse().join('');}
var L=[],G=[],q;for(q=0;q<10;q++){L[q]=comp(R[q]);G[q]=rev(R[q]);}
var PAR={0:'LLLLLL',1:'LLGLGG',2:'LLGGLG',3:'LLGGGL',4:'LGLLGG',5:'LGGLLG',6:'LGGGLL',7:'LGLGLG',8:'LGLGGL',9:'LGGLGL'};
function check(d12){var s=0,k;for(k=0;k<12;k++)s+=parseInt(d12.charAt(k),10)*(k%2===1?3:1);return (10-s%10)%10;}
function enc(d13){var p=PAR[parseInt(d13.charAt(0),10)],bits='101',k;
 for(k=1;k<7;k++)bits+=(p.charAt(k-1)==='L'?L:G)[parseInt(d13.charAt(k),10)];
 bits+='01010';
 for(k=7;k<13;k++)bits+=R[parseInt(d13.charAt(k),10)];
 return bits+'101';}
function ctx2d(){try{var cv=$('ea-cv');return cv&&cv.getContext?cv.getContext('2d'):null;}catch(e){return null;}}
function draw(bits){var x=ctx2d();if(!x||!x.fillRect)return;var m=2,i;
 x.fillStyle='#ffffff';x.fillRect(0,0,205,122);x.fillStyle='#000000';
 for(i=0;i<bits.length;i++)if(bits.charAt(i)==='1'){var tall=(i<3||(i>=45&&i<50)||i>=92);x.fillRect(5+i*m,5,m,tall?104:90);}}
function label(d13){var x=ctx2d();if(!x||!x.fillText)return;
 x.font='11px monospace';x.fillStyle='#000';
 x.fillText(d13.charAt(0),1,117);x.fillText(d13.slice(1,7),11,117);x.fillText(d13.slice(7,13),105,117);}
function render(){var v=($('ea-in').value||'').replace(/[^0-9]/g,''),note='';
 if(v.length===13){var c=check(v.slice(0,12));
  note=parseInt(v.charAt(12),10)===c?'<span class="tl-badge tl-ok">check digit valid</span> '+c+' verified with the 1,3,1,3\\u2026 weights.'
   :'<span class="tl-badge tl-no">bad check digit</span> This code should end in '+c+' \\u2014 the bars use your 13, but no scanner will accept it.';}
 else if(v.length===12){var c2=check(v);v=v+String(c2);
  note='<span class="tl-badge tl-ok">check digit computed</span> '+c2+' \\u2014 (10 \\u2212 weighted sum mod 10) mod 10.';}
 else{$('ea-out').innerHTML='<span class="tl-badge tl-no">check input</span> Enter 12 digits (the 13th is computed for you) or a full 13.';return;}
 draw(enc(v));label(v);
 $('ea-out').innerHTML='<div class="tl-big">'+v+'</div><p>'+note+'</p>'+
  '<p class="meta">95 modules: start guard 101, six left digits in the L/G parity pattern '+PAR[parseInt(v.charAt(0),10)]+' chosen by the first digit, centre guard 01010, six right digits always R, end guard 101. The default 590 is the well-known Polish company prefix from the specification examples \\u2014 GS1 assigns real prefixes commercially, so a random code here is for mockups and print tests, not for shops.</p>'+
  '<p class="meta">What the check digit catches: every single-digit error (weights 1 and 3 are both coprime with 10), and every adjacent transposition except pairs differing by exactly 5 (0\\u21945, 1\\u21946, \\u2026), which leave the weighted sum unchanged \\u2014 the well-known limit of all mod-10 schemes.</p>';
}
$('ea-go').onclick=render;$('ea-in').oninput=render;
$('ea-rnd').onclick=function(){var d='',k;for(k=0;k<12;k++)d+=Math.floor(Math.random()*10);$('ea-in').value=d;render();};
render();`,
  seo: `<h2 class="section-title">Where a printed barcode can still fail you</h2>
  <p>The encoding above is exact, but a printed code lives or dies on optics: the quiet zone of at least nine empty modules on each side, a bar-width variation under about 15% (cheap inkjet dot gain doubles thin bars and scanners read 11 for 1), and contrast that survives the shelf light — black on white, never the reverse, because most readers illuminate with a red laser and red ink reads as white. At 2 px per module the narrowest bar is 0.33 mm on a 96 dpi screen, which is under most printers\u2019 honest capability; for print, redraw at 3\u20134 px per module (the EAN spec\u2019s nominal 37.29 mm width for the full 95 modules at 0.33 mm each). And the deepest trap is not technical at all: reuse a number from the internet and two products collide in every till that trusts GS1 \u2014 test barcodes should visibly say they are tests, which is why the random button produces codes rather than letting you paste a real one quietly.</p>`,
});

// ── 71. /alat/slug — URL slug generator ──────────────────────────────────────
TOOLKIT.push({
  slug: 'slug', ic: '✂️', name: 'Slug Generator',
  title: 'URL Slug Generator — Clean ASCII Slugs From Any Title | Tukuk-OS',
  desc: 'Turn a title into a URL slug: accents stripped by NFD decomposition, symbols spelled out (& becomes and), one separator, lowercase, length cut on a boundary. All in your browser.',
  hero: 'Slug Generator', sub: 'accents stripped · & → and · boundary-safe length cut',
  navBlurb: 'Crème Brûlée becomes creme-brulee — accents stripped properly, symbols spelled out before they are dropped, and the length cut never leaves a dangling dash.',
  hubBlurb: 'a URL slug maker with real accent folding, symbol spelling, separator collapsing and a word-boundary-safe length cut',
  lead: 'Search-engine guidance on slugs is short and boring, which is the point: lowercase, hyphens, no keyword stuffing, and then <b>stop changing them</b>. The interesting work is in the conversion. <b>NFD decomposition</b> turns an "é" into "e" plus a combining mark, so deleting the mark range leaves a plain "e" — fold by stripping diacritics and you get "crme" instead. Symbols get <b>spelled out before they are dropped</b>, so "Tea & Toast" slugs as tea-and-toast rather than tea-toast, and the length cut happens on a separator boundary so a truncated slug never ends in a dangling dash. The result is checked against pure ASCII at the end: a correct slug needs no percent-encoding at all.',
  form: `<div class="tl-form">
  ${field('Title', '<input id="sl-in" type="text" value="Crème Brûlée — Recipe #7 at 3pm & 50% off!" size="48">')}
  ${field('Separator', '<select id="sl-sep"><option value="-" selected>hyphen (recommended)</option><option value="_">underscore (snake_case)</option></select>')}
  ${field('Max length', '<input id="sl-max" type="number" min="8" max="120" step="1" value="60">')}
  <button class="tl-btn" id="sl-copy" type="button">Copy slug</button>
</div>
<div class="tl-res" id="sl-out">—</div>`,
  script: `
var $=function(id){return document.getElementById(id);};
function spell(s){return s.replace(/&/g,' and ').replace(/@/g,' at ').replace(/%/g,' percent ')
 .replace(/\\u00b0/g,' degrees ').replace(/\\u00a3/g,' pound ').replace(/\\u20ac/g,' euro ').replace(/\\u00a7/g,' section ');}
function make(){var sep=$('sl-sep').value;
 var s=spell($('sl-in').value.toLowerCase());
 if(s.normalize)s=s.normalize('NFD').replace(/[\\u0300-\\u036f]/g,'');
 s=s.replace(/[^a-z0-9]+/g,sep);
 var double=sep+sep;while(s.indexOf(double)>=0)s=s.split(double).join(sep);
 s=s.replace(new RegExp('^'+sep+'+|'+sep+'+$','g'),'');
 var max=parseInt($('sl-max').value,10)||60,cut=false;
 if(s.length>max){s=s.slice(0,max);s=s.replace(new RegExp('[^a-z0-9]+$'),'');cut=true;}
 return{s:s,cut:cut};}
function render(){var r=make(),out=r.s;
 var h='<div class="tl-big">'+(out||'<span class="tl-badge tl-no">empty</span>')+'</div>';
 h+='<table class="tl-tab"><tbody><tr><td>Length</td><td>'+out.length+' characters</td></tr>';
 h+='<tr><td>Needs percent-encoding</td><td>'+(out&&!/[^a-z0-9_-]/.test(out)?'no \\u2014 pure ASCII':'yes \\u2014 '+encodeURIComponent(out))+'</td></tr>';
 h+='<tr><td>Words joined</td><td>'+(out?(out.split(/[-_]/).length):0)+'</td></tr></tbody></table>';
 if(r.cut)h+='<p class="meta">Cut to '+$('sl-max').value+' characters at the last separator boundary \\u2014 a slug ending in a dangling dash is the mark of a naive slicer.</p>';
 if(!out)h+='<p class="meta">Nothing survived: the input had no letters or digits at all (emoji-only titles really do happen in the logs of every CMS).</p>';
 h+='<p class="meta">Rules, in order: lowercase; spell & @ % \\u00b0 \\u00a3 \\u20ac; NFD-fold accents (crème → creme, never crme); everything outside a-z0-9 becomes one separator; collapse repeats; trim head and tail; cut long slugs on a boundary. Emoji and CJK are dropped rather than transliterated \\u2014 a slug that survives every CMS export is a boring slug.</p>';
 $('sl-out').innerHTML=h;}
$('sl-copy').onclick=function(){try{var r=make();
 if(r.s&&navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(r.s);}catch(e){}};
$('sl-in').oninput=render;$('sl-sep').onchange=render;$('sl-max').oninput=render;render();`,
  seo: `<h2 class="section-title">The one rule that matters more than the folding</h2>
  <p>Do not rename a live slug. Every change turns old links into 404s or, if you 301 them, into redirect chains that search engines follow less eagerly each hop — and a page inside a chain loses the crawl budget it used to spend on you. Hyphens beat underscores because search engines have historically treated the hyphen as a word boundary and the underscore as a glue character, so creme-brulee reads as two words and creme_brulee as one mangled one; browsers and humans also word-break hyphenated URLs at the line edge. But none of that justifies churn: a mediocre slug that has accumulated six years of links outperforms a perfect slug that had to be 301-recovered. Generate the slug once, before the URL is published, and let it stay.</p>`,
});

// ── 72. /alat/flashcards — self-made study deck ──────────────────────────────
TOOLKIT.push({
  slug: 'flashcards', ic: '🗂', name: 'Flashcards',
  title: 'Flashcard Maker — Build a Study Deck in Your Browser | Tukuk-OS',
  desc: 'Turn any list of "front | back" lines into a flip, shuffle flashcard deck that keeps score. Vocabulary, dates, formulas — it runs in your browser and stores nothing.',
  hero: 'Flashcards', sub: 'one card per line · flip · shuffle · knew-it tally',
  navBlurb: 'Paste any "front | back" list and drill it as a shuffleable flashcard deck that tracks what you keep missing — no account, nothing stored.',
  hubBlurb: 'write cards as "question | answer" lines, then flip, shuffle and mark what you knew — the deck lives only in your tab',
  lead: 'Retrieval beats re-reading: a fact you try to answer and then check sticks far better than the same fact read fifty times. This maker turns plain text — <code>front | back</code>, one card per line — into a deck that shuffles, flips and keeps a knew-it tally, entirely in your browser.',
  form: `<div class="tl-form">
  ${field('Your deck — one card per line, written front | back', '<textarea class="tl-in" id="fc-in" spellcheck="false">capital of Japan | Tokyo\nlargest planet | Jupiter\nH2O is the formula for | water\nspeed of light, roughly | 300,000 km/s\ncurrency of Malaysia | ringgit\nwho wrote Hamlet | Shakespeare\nsquare root of 144 | 12\nsmallest prime number | 2</textarea>')}
  <button class="tl-btn primary" id="fc-go" type="button">Start deck</button>
  <button class="tl-btn" id="fc-reveal" type="button">Reveal answer</button>
  <button class="tl-btn" id="fc-next" type="button">Next card ▶</button>
  <button class="tl-btn" id="fc-shuffle" type="button">🔀 Shuffle</button>
  <button class="tl-btn" id="fc-know" type="button" hidden>✓ Knew it</button>
  <button class="tl-btn" id="fc-later" type="button" hidden>✗ Show it again later</button>
</div>
<div class="tl-res" id="fc-out">—</div>`,
  css: `[hidden]{display:none!important}`,
  script: `
var $=function(id){return document.getElementById(id);};
var CARDS=[],pos=0,showBack=false,knew=0,later=0;
function parse(){var lines=$('fc-in').value.split('\\n'),out=[],i,p;
 for(i=0;i<lines.length;i++){p=lines[i].split('|');
  if(p.length>=2&&p[0].trim()&&p[1].trim())out.push([p[0].trim(),p[1].trim()]);}
 return out;}
function render(){var el=$('fc-out'),c=CARDS[pos],h=!showBack||!CARDS.length;
 $('fc-know').hidden=h;$('fc-later').hidden=h;
 if(!CARDS.length){el.innerHTML='<span class="tl-badge tl-no">empty deck</span> One card per line as <code>front | back</code>, then press Start deck.';return;}
 var tally='<p class="meta">Card '+(pos+1)+' of '+CARDS.length+' · knew it '+knew+(later?' · queued again '+later:'')+'</p>';
 if(showBack)el.innerHTML='<div class="tl-big">'+c[1]+'</div><p class="meta">The question was: '+c[0]+'</p>'+tally;
 else el.innerHTML='<div class="tl-big">'+c[0]+'</div>'+tally+'<p class="meta">Say the answer to yourself first — then hit Reveal.</p>';}
function next(){pos++;if(pos>=CARDS.length)pos=0;showBack=false;render();}
function start(){CARDS=parse();pos=0;showBack=false;knew=0;later=0;render();}
$('fc-go').onclick=start;
$('fc-reveal').onclick=function(){if(CARDS.length){showBack=true;render();}};
$('fc-next').onclick=function(){if(CARDS.length)next();};
$('fc-shuffle').onclick=function(){var i,j,t;for(i=CARDS.length-1;i>0;i--){j=Math.floor(Math.random()*(i+1));t=CARDS[i];CARDS[i]=CARDS[j];CARDS[j]=t;}pos=0;showBack=false;render();};
$('fc-know').onclick=function(){if(CARDS.length){knew++;next();}};
$('fc-later').onclick=function(){if(CARDS.length){var c=CARDS[pos];CARDS.push([c[0],c[1]]);later++;next();}};
start();`,
  seo: `<h2 class="section-title">Why "show it again later" is the whole trick</h2>
  <p>Two effects carry flashcards: testing yourself before you look (retrieval practice) and bringing the misses back sooner than the easy ones (spacing). The ✗ button queues the card to the back of the deck so it returns while the slip is still fresh; the ✓ lets a known fact ride. What this page deliberately is not: a long-term scheduler. That needs a server that remembers you between visits, and everything here forgets the deck the moment the tab closes — which is also why you can keep using it for free.</p>`,
});

// ── 73. /alat/quiz-maker — notes to self-marking quiz ────────────────────────
TOOLKIT.push({
  slug: 'quiz-maker', ic: '❓', name: 'Quiz Maker',
  title: 'Quiz Maker — Turn Notes into a Self-Marking Quiz | Tukuk-OS',
  desc: 'Write questions as "Q | correct | wrong | wrong" lines and get a click-to-answer quiz that marks itself and keeps score. Runs in your browser, saves nothing.',
  hero: 'Quiz Maker', sub: 'one question per line · 2–4 options · instant marking · score at the end',
  navBlurb: 'Turn any notes into a self-marking multiple-choice quiz with the "question | correct | wrong" line format — options reshuffle every sit.',
  hubBlurb: 'paste "question | correct answer | wrong answers" lines and sit a self-marking quiz with shuffled options and a final score',
  lead: 'The quickest quiz that needs no account: one line is one question, split by <code>|</code> — question first, then the correct answer, then up to two wrong options. Distractors are optional (a two-option question works), the option order reshuffles on every sit, and the whole quiz is plain text you can email to a classmate who pastes it in and plays.',
  form: `<div class="tl-form">
  ${field('Your questions — one per line: question | correct answer | wrong | wrong', '<textarea class="tl-in" id="qz-in" spellcheck="false">What is the capital of France? | Paris | Lyon | Nice\nWhich planet is called the Red Planet? | Mars | Venus | Jupiter\nHow many continents are there? | 7 | 5 | 6\nWhich is the largest ocean? | Pacific | Atlantic | Indian\nWhich gas do plants breathe in? | carbon dioxide | oxygen | nitrogen</textarea>')}
  <button class="tl-btn primary" id="qz-go" type="button">▶ Start quiz</button>
  <button class="tl-btn tl-opt" id="qz-a0" type="button" hidden></button>
  <button class="tl-btn tl-opt" id="qz-a1" type="button" hidden></button>
  <button class="tl-btn tl-opt" id="qz-a2" type="button" hidden></button>
  <button class="tl-btn tl-opt" id="qz-a3" type="button" hidden></button>
  <button class="tl-btn" id="qz-next" type="button" hidden>Next question ▶</button>
</div>
<div class="tl-res" id="qz-fb"></div>
<div class="tl-res" id="qz-out">—</div>`,
  css: `[hidden]{display:none!important}.tl-opt{display:block;width:100%;text-align:left;margin-top:8px;padding:12px 16px;font-size:1rem}`,
  script: `
var $=function(id){return document.getElementById(id);};
var Q=[],pos=0,score=0,answered=false,started=false;
function esc(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function parse(){var lines=$('qz-in').value.split('\\n'),out=[],i,p,j,opts;
 for(i=0;i<lines.length;i++){p=lines[i].split('|');
  if(p.length>=2&&p[0].trim()&&p[1].trim()){opts=[];
   for(j=1;j<p.length&&opts.length<4;j++)if(p[j].trim())opts.push(p[j].trim());
   out.push({q:p[0].trim(),ok:opts[0],opts:opts});}}
 return out;}
function shuffle(a){var i,j,t;for(i=a.length-1;i>0;i--){j=Math.floor(Math.random()*(i+1));t=a[i];a[i]=a[j];a[j]=t;}return a;}
function hideOpts(){var i,b;for(i=0;i<4;i++){b=$('qz-a'+i);if(b)b.hidden=true;}}
function showQ(){var q=Q[pos],i,b;q.sh=shuffle(q.opts.slice());answered=false;$('qz-fb').innerHTML='';$('qz-next').hidden=true;
 for(i=0;i<4;i++){b=$('qz-a'+i);if(!b)continue;
  if(i<q.sh.length){b.hidden=false;b.textContent=q.sh[i];}else b.hidden=true;}
 render();}
function render(){var el=$('qz-out');
 if(!started){el.innerHTML='<span class="tl-badge">ready</span> <b>'+parse().length+'</b> questions parsed from the box above. Press Start quiz to sit them — option order reshuffles for every question and every sit.';hideOpts();$('qz-next').hidden=true;return;}
 if(pos>=Q.length){var pct=Q.length?Math.round(100*score/Q.length):0;
  el.innerHTML='<div class="tl-big">'+score+' / '+Q.length+' · '+pct+'%</div><p class="meta">'+(pct===100?'Flawless — now try teaching it to someone else.':pct>=70?'Strong run. The misses are worth a second sit.':pct>=40?'Getting there — start again and the reshuffled options will catch different gaps.':'Worth another go: read the misses below, then sit it again.')+'</p>';
  hideOpts();$('qz-next').hidden=true;return;}
 var q=Q[pos];
 el.innerHTML='<p class="meta"><b>Question '+(pos+1)+' of '+Q.length+'</b> · score '+score+'</p><div class="tl-big">'+esc(q.q)+'</div>';}
function answer(i){if(!started||answered||pos>=Q.length)return;
 var q=Q[pos],mine=q.sh[i],ok=mine===q.ok;answered=true;if(ok)score++;
 $('qz-fb').innerHTML=ok?'<span class="tl-badge tl-ok">correct</span> '+esc(mine):'<span class="tl-badge tl-no">not quite</span> you said '+esc(mine)+' — the answer is <b>'+esc(q.ok)+'</b>';
 hideOpts();$('qz-next').hidden=false;render();}
function start(){Q=parse();if(!Q.length)return;pos=0;score=0;started=true;showQ();}
$('qz-go').onclick=start;
$('qz-next').onclick=function(){if(!started)return;pos++;if(pos<Q.length)showQ();else render();};
function bind(i){$('qz-a'+i).onclick=function(){answer(i);};}
bind(0);bind(1);bind(2);bind(3);
render();`,
  seo: `<h2 class="section-title">On writing distractors worth the name</h2>
  <p>A good wrong answer is a mistake somebody actually makes: the unit you forgot to convert, the plural you dropped, the second-best fact that is true of something else. Pick those and the quiz teaches discrimination, not just memory; pick <i>banana</i> and <i>pineapple</i> and it becomes a joke with a scoreboard. Two options is the minimum this tool accepts, three is the sweet spot, and four is where tired students start reading the last option first because they have learned to skip the first three.</p>`,
});

// ── 74. /alat/times-tables — multiplication drill ────────────────────────────
TOOLKIT.push({
  slug: 'times-tables', ic: '✖️', name: 'Times Tables Trainer',
  title: 'Times Tables Trainer — Multiplication Practice with Scoring | Tukuk-OS',
  desc: 'Drill the 2–12 times tables, single or mixed, with streaks, a per-minute speed score and an automatic review list of every miss.',
  hero: 'Times Tables Trainer', sub: 'tables 2–12 or mixed · streak tracking · speed score · miss review',
  navBlurb: 'Multiplication drills for one table or all of them mixed, with streaks, questions-per-minute and a review list built from your own misses.',
  hubBlurb: 'pick a table or go mixed, beat the clock, and get every miss back as a review table at the end of the run',
  lead: 'Fluency is automatic recall, and automatic recall comes from short frequent runs with instant feedback — which is exactly what this page does: one problem at a time, checked the moment you press Enter, misses logged, and a review table at the finish so the last ten minutes of practice go where they are needed.',
  form: `<div class="tl-form">
  ${field('Tables', '<select id="tt-tab"><option value="2">2s</option><option value="3">3s</option><option value="4">4s</option><option value="5">5s</option><option value="6">6s</option><option value="7">7s</option><option value="8">8s</option><option value="9">9s</option><option value="10">10s</option><option value="11">11s</option><option value="12">12s</option><option value="mixed" selected>mixed 2–12</option></select>')}
  ${field('Run length', '<select id="tt-len"><option value="10" selected>10 questions</option><option value="20">20 questions</option><option value="50">50 questions</option></select>')}
</div>
<div class="tl-res" id="tt-q">—</div>
<div class="tl-form">
  ${field('Your answer', '<input id="tt-ans" type="number" step="1" autocomplete="off">')}
  <button class="tl-btn primary" id="tt-go" type="button">Check ✓</button>
  <button class="tl-btn" id="tt-new" type="button">Skip ↷</button>
</div>
<div class="tl-res" id="tt-out">—</div>`,
  script: `
var $=function(id){return document.getElementById(id);};
var cur=[0,0],made=0,score=0,streak=0,best=0,t0=0,wrongs=[],done=false;
function gen(){var t=$('tt-tab').value,a,b;
 if(t==='mixed'){a=2+Math.floor(Math.random()*11);b=2+Math.floor(Math.random()*11);}
 else{a=parseInt(t,10);b=1+Math.floor(Math.random()*12);}
 cur=[a,b];$('tt-ans').value='';$('tt-q').innerHTML='<div class="tl-big">'+a+' × '+b+' = ?</div>';}
function secs(){return t0?Math.round((Date.now()-t0)/1000):0;}
function line(){return '<p class="meta">Question '+(made+1)+' of '+$('tt-len').value+' · score '+score+'/'+made+' · streak '+streak+(best?' · best '+best:'')+' · '+secs()+'s</p>';}
function finish(){done=true;var s=secs();
 var h='<div class="tl-big">'+score+' / '+made+' in '+s+'s</div>';
 if(wrongs.length){h+='<table class="tl-tab"><thead><tr><th>Missed</th><th>Answer</th></tr></thead><tbody>'
  +wrongs.map(function(w){return '<tr><td>'+w[0]+'</td><td>'+w[1]+'</td></tr>';}).join('')+'</tbody></table><p class="meta">Now run the misses — that part is the whole workout.</p>';}
 else{h+='<p class="meta">Flawless run.</p>';}
 if(s>0)h+='<p class="meta">Speed: '+((made*60)/s).toFixed(1)+' questions per minute.</p>';
 $('tt-out').innerHTML=h;$('tt-q').innerHTML='<div class="tl-big">Run finished</div>';}
function check(){if(done)return;
 var v=$('tt-ans').value.trim();
 if(v===''){$('tt-out').innerHTML='<span class="tl-badge tl-no">type an answer</span> Work it out in your head, then key the number and press Check (or just hit Enter).';return;}
 var ans=parseInt(v,10),right=cur[0]*cur[1];made++;if(!t0)t0=Date.now();
 if(ans===right){score++;streak++;if(streak>best)best=streak;}
 else{streak=0;wrongs.push([cur[0]+' × '+cur[1],String(right)]);}
 $('tt-out').innerHTML=(ans===right?'<span class="tl-badge tl-ok">correct</span>':'<span class="tl-badge tl-no">missed — logged for review</span>')+line();
 if(made>=parseInt($('tt-len').value,10)){finish();return;}
 gen();}
function skip(){if(done)return;made++;
 $('tt-out').innerHTML='<span class="tl-badge">skipped</span>'+line();
 if(made>=parseInt($('tt-len').value,10)){finish();return;}gen();}
function reset(){made=0;score=0;streak=0;best=0;t0=0;wrongs=[];done=false;gen();
 $('tt-out').innerHTML='<span class="tl-badge">go</span>'+line();$('tt-ans').focus&&$('tt-ans').focus();}
$('tt-go').onclick=check;$('tt-new').onclick=skip;$('tt-tab').onchange=reset;$('tt-len').onchange=reset;reset();`,
  seo: `<h2 class="section-title">Why the misses come back and the easy ones do not</h2>
  <p>Practising what you already know feels productive and teaches almost nothing; the learning lives at the edge of what you can do. So the run logs every miss with its answer, and the review table at the finish is the list worth running again tomorrow — first mixed, then as a single-table drill if one digit keeps winning. Streaks are there because short-term feedback loops are what keep ten quiet minutes actually happening.</p>`,
});

// ── 75. /alat/clock-reading — analogue face practice ─────────────────────────
TOOLKIT.push({
  slug: 'clock-reading', ic: '🕐', name: 'Clock Reading',
  title: 'Clock Reading Practice — Learn to Read an Analogue Clock | Tukuk-OS',
  desc: 'Practice reading analogue clock faces: o-clock, half past, quarter to and five-minute drills with a drawn clock face and instant marking.',
  hero: 'Clock Reading', sub: 'drawn clock face · o\u2019clock → 5-minute levels · self-marking',
  navBlurb: 'A drawn analogue face, four difficulty levels and instant marking — the way children actually learn that the long hand counts minutes.',
  hubBlurb: 'read the drawn clock face and type the time — four levels from o\u2019clock to any five-minute mark, marked instantly',
  lead: 'Digital did it to clocks the way calculators did it to mental arithmetic: a whole generation can read a screen and cannot read a face. This drill draws a real analogue clock — hour hand short, minute hand long, hands placed with the actual gear maths (the hour hand creeps between numbers as minutes pass) — and asks for the time, from <i>o\u2019clock</i> down to any five-minute mark.',
  form: `<div class="tl-form">
  ${field('Difficulty', '<select id="cr-lv"><option value="hour" selected>o\u2019clock times</option><option value="half">half past</option><option value="quarter">quarter past / to</option><option value="five">any 5-minute mark</option></select>')}
</div>
<div class="tl-clock" id="cr-face"></div>
<div class="tl-form">
  ${field('What time is it?', '<input id="cr-ans" type="text" placeholder="e.g. 4:30" autocomplete="off">')}
  <button class="tl-btn primary" id="cr-go" type="button">Check ✓</button>
  <button class="tl-btn" id="cr-new" type="button">New clock ↷</button>
</div>
<div class="tl-res" id="cr-out">—</div>`,
  css: `.tl-clock{display:flex;justify-content:center;padding:8px}.tl-clock svg{background:var(--panel,#171a21);border:1px solid var(--line,#2c313c);border-radius:50%}`,
  script: `
var $=function(id){return document.getElementById(id);};
var cur=[3,0],misses=0,solved=0;
function face(h,m){var s='<svg viewBox="0 0 100 100" width="190" height="190">',n,a,x,y;
 s+='<circle cx="50" cy="50" r="48" fill="none" stroke="#3a4150" stroke-width="2"/>';
 for(n=1;n<=12;n++){a=n*30*Math.PI/180;x=50+38*Math.sin(a);y=50-38*Math.cos(a);
  s+='<text x="'+x.toFixed(1)+'" y="'+(y+3.5).toFixed(1)+'" font-size="9" text-anchor="middle" fill="#9aa3b2">'+n+'</text>';}
 a=((h%12)+m/60)*30*Math.PI/180;
 s+='<line x1="50" y1="50" x2="'+(50+24*Math.sin(a)).toFixed(1)+'" y2="'+(50-24*Math.cos(a)).toFixed(1)+'" stroke="#e6e9ef" stroke-width="4" stroke-linecap="round"/>';
 a=m*6*Math.PI/180;
 s+='<line x1="50" y1="50" x2="'+(50+33*Math.sin(a)).toFixed(1)+'" y2="'+(50-33*Math.cos(a)).toFixed(1)+'" stroke="#4c8dff" stroke-width="2" stroke-linecap="round"/>';
 s+='<circle cx="50" cy="50" r="2.5" fill="#e6e9ef"/></svg>';
 return s;}
function pad(m){return (m<10?'0':'')+m;}
function gen(){var lv=$('cr-lv').value,h=1+Math.floor(Math.random()*12),m=0;
 if(lv==='half')m=Math.random()<0.5?0:30;
 else if(lv==='quarter')m=[0,15,30,45][Math.floor(Math.random()*4)];
 else if(lv==='five')m=Math.floor(Math.random()*12)*5;
 cur=[h,m];$('cr-face').innerHTML=face(h,m);$('cr-ans').value='';
 $('cr-out').innerHTML='<span class="tl-badge">read the face</span> Short hand = hour, long hand = minutes. Type the answer as <b>h:mm</b>, for example 4:30. Solved '+solved+(misses?' · missed '+misses:'')+'.';}
function check(){var mt=$('cr-ans').value.trim().match(/^(\\d{1,2}):(\\d{2})$/);
 if(!mt){$('cr-out').innerHTML='<span class="tl-badge tl-no">check input</span> Write it as <b>h:mm</b> — like 4:30 or 11:15.';return;}
 var h=parseInt(mt[1],10)%12,m=parseInt(mt[2],10);
 if(h===cur[0]%12&&m===cur[1]){
  $('cr-out').innerHTML='<span class="tl-badge tl-ok">correct</span> It was '+cur[0]+':'+pad(cur[1])+'. New clock coming up.';
  solved++;gen();return;}
 misses++;
 if(misses%3===0){$('cr-out').innerHTML='<span class="tl-badge tl-no">here it is</span> The answer was <b>'+cur[0]+':'+pad(cur[1])+'</b> — hour hand near '+cur[0]+', minute hand on '+((cur[1]/5)||12)+'. Here is a fresh face.';gen();}
 else $('cr-out').innerHTML='<span class="tl-badge tl-no">not that one</span> Remember: the short hand points at the hour it is walking toward, the long hand counts fives between the numbers. Try again or press New clock.';}
$('cr-go').onclick=check;$('cr-new').onclick=gen;$('cr-lv').onchange=gen;
$('cr-ans').onkeydown=function(e){if(e&&e.key==='Enter')check();};
gen();`,
  seo: `<h2 class="section-title">The one detail every clock face gets wrong</h2>
  <p>The hour hand is not parked on the number — it crawls. At 2:30 it should sit exactly halfway between II and III, because a full dial sweep takes twelve hours, not twelve hops; this page draws it at <code>(hour + minutes/60) × 30°</code> for exactly that reason, which is also the read-your-own-face cue: the number the hour hand has just left is the hour, the number the minute hand points at is five times that. Once a child can explain why 2:30 looks "a bit past the 2", o\u2019clock to five-minute mastery is the same skill at finer steps.</p>`,
});

// ── 76. /alat/periodic-table — element explorer ──────────────────────────────
TOOLKIT.push({
  slug: 'periodic-table', ic: '🧪', name: 'Periodic Table Explorer',
  title: 'Periodic Table Explorer — Search All 118 Elements | Tukuk-OS',
  desc: 'Search or browse every element by name, symbol or number, with standard atomic weight and family — plus a random-element button for class drills.',
  hero: 'Periodic Table Explorer', sub: 'all 118 elements · search by name, symbol or number · random element drill',
  navBlurb: 'Every element from hydrogen to oganesson: atomic weight, family and state, searchable by name, symbol or number — with a random-element button.',
  hubBlurb: 'look up any of the 118 elements by name, symbol or number — weight, family and state included, plus a random element for class drills',
  lead: 'The whole table in one search box: name, symbol or atomic number, matched as you type. Weights are the IUPAC standard atomic weights rounded to four or five significant figures; for radioactive elements with no stable isotope the mass number of the longest-lived known isotope is shown, marked with a tilde. One hundred eighteen rows, no account, nothing fetched — the data is part of the page.',
  form: `<div class="tl-form">
  ${field('Search — name, symbol or number', '<input id="el-q" type="text" placeholder="e.g. oxygen, Fe, 47…" autocomplete="off" spellcheck="false">')}
  <button class="tl-btn" id="el-rand" type="button">🎲 Random element</button>
  <button class="tl-btn" id="el-all" type="button">Show the whole table</button>
</div>
<div class="tl-res" id="el-out">—</div>`,
  css: `.el-sym{display:inline-block;width:2.4em;text-align:center;font-weight:700}`,
  script: `
var $=function(id){return document.getElementById(id);};
var D='1,H,Hydrogen,1.008,nm,gas;2,He,Helium,4.0026,noble,gas;3,Li,Lithium,6.94,alkali,solid;4,Be,Beryllium,9.012,alkaline,solid;5,B,Boron,10.81,metalloid,solid;6,C,Carbon,12.011,nm,solid;7,N,Nitrogen,14.007,nm,gas;8,O,Oxygen,15.999,nm,gas;9,F,Fluorine,18.998,halogen,gas;10,Ne,Neon,20.180,noble,gas;11,Na,Sodium,22.990,alkali,solid;12,Mg,Magnesium,24.305,alkaline,solid;13,Al,Aluminium,26.982,post,solid;14,Si,Silicon,28.085,metalloid,solid;15,P,Phosphorus,30.974,nm,solid;16,S,Sulfur,32.06,nm,solid;17,Cl,Chlorine,35.45,halogen,gas;18,Ar,Argon,39.95,noble,gas;19,K,Potassium,39.098,alkali,solid;20,Ca,Calcium,40.078,alkaline,solid;21,Sc,Scandium,44.956,trans,solid;22,Ti,Titanium,47.867,trans,solid;23,V,Vanadium,50.942,trans,solid;24,Cr,Chromium,51.996,trans,solid;25,Mn,Manganese,54.938,trans,solid;26,Fe,Iron,55.845,trans,solid;27,Co,Cobalt,58.933,trans,solid;28,Ni,Nickel,58.693,trans,solid;29,Cu,Copper,63.546,trans,solid;30,Zn,Zinc,65.38,trans,solid;31,Ga,Gallium,69.723,post,solid;32,Ge,Germanium,72.630,metalloid,solid;33,As,Arsenic,74.922,metalloid,solid;34,Se,Selenium,78.971,nm,solid;35,Br,Bromine,79.904,halogen,liq;36,Kr,Krypton,83.798,noble,gas;37,Rb,Rubidium,85.468,alkali,solid;38,Sr,Strontium,87.62,alkaline,solid;39,Y,Yttrium,88.906,trans,solid;40,Zr,Zirconium,91.224,trans,solid;41,Nb,Niobium,92.906,trans,solid;42,Mo,Molybdenum,95.95,trans,solid;43,Tc,Technetium,~98,trans,solid;44,Ru,Ruthenium,101.07,trans,solid;45,Rh,Rhodium,102.91,trans,solid;46,Pd,Palladium,106.42,trans,solid;47,Ag,Silver,107.87,trans,solid;48,Cd,Cadmium,112.41,trans,solid;49,In,Indium,114.82,post,solid;50,Sn,Tin,118.71,post,solid;51,Sb,Antimony,121.76,metalloid,solid;52,Te,Tellurium,127.60,metalloid,solid;53,I,Iodine,126.90,halogen,solid;54,Xe,Xenon,131.29,noble,gas;55,Cs,Caesium,132.91,alkali,solid;56,Ba,Barium,137.33,alkaline,solid;57,La,Lanthanum,138.91,lanth,solid;58,Ce,Cerium,140.12,lanth,solid;59,Pr,Praseodymium,140.91,lanth,solid;60,Nd,Neodymium,144.24,lanth,solid;61,Pm,Promethium,~145,lanth,solid;62,Sm,Samarium,150.36,lanth,solid;63,Eu,Europium,151.96,lanth,solid;64,Gd,Gadolinium,157.25,lanth,solid;65,Tb,Terbium,158.93,lanth,solid;66,Dy,Dysprosium,162.50,lanth,solid;67,Ho,Holmium,164.93,lanth,solid;68,Er,Erbium,167.26,lanth,solid;69,Tm,Thulium,168.93,lanth,solid;70,Yb,Ytterbium,173.05,lanth,solid;71,Lu,Lutetium,174.97,lanth,solid;72,Hf,Hafnium,178.49,trans,solid;73,Ta,Tantalum,180.95,trans,solid;74,W,Tungsten,183.84,trans,solid;75,Re,Rhenium,186.21,trans,solid;76,Os,Osmium,190.23,trans,solid;77,Ir,Iridium,192.22,trans,solid;78,Pt,Platinum,195.08,trans,solid;79,Au,Gold,196.97,trans,solid;80,Hg,Mercury,200.59,trans,liq;81,Tl,Thallium,204.38,post,solid;82,Pb,Lead,207.2,post,solid;83,Bi,Bismuth,208.98,post,solid;84,Po,Polonium,~209,post,solid;85,At,Astatine,~210,halogen,solid;86,Rn,Radon,~222,noble,gas;87,Fr,Francium,~223,alkali,solid;88,Ra,Radium,~226,alkaline,solid;89,Ac,Actinium,~227,actin,solid;90,Th,Thorium,232.04,actin,solid;91,Pa,Protactinium,231.04,actin,solid;92,U,Uranium,238.03,actin,solid;93,Np,Neptunium,~237,actin,solid;94,Pu,Plutonium,~244,actin,solid;95,Am,Americium,~243,actin,solid;96,Cm,Curium,~247,actin,solid;97,Bk,Berkelium,~247,actin,solid;98,Cf,Californium,~251,actin,solid;99,Es,Einsteinium,~252,actin,solid;100,Fm,Fermium,~257,actin,solid;101,Md,Mendelevium,~258,actin,solid;102,No,Nobelium,~259,actin,solid;103,Lr,Lawrencium,~266,actin,solid;104,Rf,Rutherfordium,~267,trans,solid;105,Db,Dubnium,~268,trans,solid;106,Sg,Seaborgium,~269,trans,solid;107,Bh,Bohrium,~270,trans,solid;108,Hs,Hassium,~277,trans,solid;109,Mt,Meitnerium,~278,unknown,solid;110,Ds,Darmstadtium,~281,unknown,solid;111,Rg,Roentgenium,~282,unknown,solid;112,Cn,Copernicium,~285,unknown,solid;113,Nh,Nihonium,~286,unknown,solid;114,Fl,Flerovium,~289,unknown,solid;115,Mc,Moscovium,~290,unknown,solid;116,Lv,Livermorium,~293,unknown,solid;117,Ts,Tennessine,~294,unknown,solid;118,Og,Oganesson,~294,unknown,solid',
  ELS=D.split(';').map(function(r){var p=r.split(',');return {n:+p[0],s:p[1],name:p[2],w:p[3],fam:p[4],st:p[5]};}),
  FAM={alkali:'alkali metal',alkaline:'alkaline earth',trans:'transition metal',post:'post-transition',metalloid:'metalloid',nm:'reactive nonmetal',halogen:'halogen',noble:'noble gas',lanth:'lanthanide',actin:'actinide',unknown:'synthetic (properties largely unmeasured)'},
  ST={gas:'gas',liq:'liquid',solid:'solid'};
function esc(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function rows(list,limit){var i,html='<table class="tl-tab"><thead><tr><th>#</th><th>Symbol</th><th>Name</th><th>Weight</th><th>Family</th></tr></thead><tbody>';
 for(i=0;i<list.length&&i<(limit||120);i++)html+='<tr><td>'+list[i].n+'</td><td class="el-sym">'+list[i].s+'</td><td>'+esc(list[i].name)+'</td><td>'+list[i].w+'</td><td>'+FAM[list[i].fam]+'</td></tr>';
 return html+'</tbody></table>';}
function card(e){return '<div class="tl-big">'+e.n+' · '+esc(e.name)+' ('+e.s+')</div>'
 +'<table class="tl-tab"><tbody>'
 +'<tr><td>Standard atomic weight</td><td>'+e.w+(e.w.charAt(0)==='~'?' u (longest-lived isotope)':' u')+'</td></tr>'
 +'<tr><td>Family</td><td>'+FAM[e.fam]+'</td></tr>'
 +'<tr><td>State at 25 °C</td><td>'+ST[e.st]+'</td></tr>'
 +'<tr><td>Atomic number</td><td>'+e.n+' protons</td></tr></tbody></table>';}
function render(){var q=$('el-q').value.trim().toLowerCase(),el=$('el-out'),list;
 if(!q){el.innerHTML=card(ELS[0])+'<p class="meta">Showing hydrogen first — type to search, press <b>Show the whole table</b> for all 118, or take the random-element drill. Weights: IUPAC standard atomic values, rounded; ~ marks radioactive elements with no stable isotope.</p>';return;}
 list=ELS.filter(function(e){return e.name.toLowerCase().indexOf(q)>=0||e.s.toLowerCase()===q||String(e.n)===q;});
 if(!list.length){el.innerHTML='<span class="tl-badge tl-no">no match</span> Nothing in the table answers to <b>'+esc(q)+'</b>. Try part of a name (gold), a symbol (Au) or a number (79).';return;}
 if(list.length===1){el.innerHTML=card(list[0]);return;}
 el.innerHTML=rows(list,60)+'<p class="meta">'+list.length+' matches — narrow the search for a full card.</p>';}
$('el-q').oninput=render;
$('el-rand').onclick=function(){var e=ELS[Math.floor(Math.random()*ELS.length)];$('el-q').value='';
 $('el-out').innerHTML=card(e)+'<p class="meta">Random draw — name it from memory, then search it to check.</p>';};
$('el-all').onclick=function(){var q=$('el-q');q.value='';$('el-out').innerHTML=rows(ELS)+'<p class="meta">All 118 elements, hydrogen to oganesson. Search above to focus one.</p>';};
render();`,
  seo: `<h2 class="section-title">What the numbers actually mean</h2>
  <p>The atomic weight is not the proton count — it is the average mass of the element as found in nature, weighted across its isotopes, which is why chlorine is 35.45 and not 35: a third of natural chlorine is the isotope with 17 neutrons and two thirds carry 19. The families on this page are the column groups of the standard table; the lanthanides and actinides are listed in place by number rather than in the two floating rows, which is the honest way for a search box even if it breaks the printed habit.</p>`,
});

// ── 77. /alat/flags-quiz — country ↔ flag drill ──────────────────────────────
TOOLKIT.push({
  slug: 'flags-quiz', ic: '🌍', name: 'Flags Quiz',
  title: 'Flags Quiz — Country ↔ Emoji Flag Multiple Choice | Tukuk-OS',
  desc: 'Quiz yourself on the world\u2019s countries: flag to name or name to flag, four options, instant marking and score. About 170 countries, all in-browser.',
  hero: 'Flags Quiz', sub: 'flag ⇄ country name · four options · scored · about 170 countries',
  navBlurb: 'Two-way flag drill over some 170 countries: see the flag and name it, or see the name and pick the flag — scored, self-marking, in-browser.',
  hubBlurb: 'match countries to their emoji flags both ways — name→flag or flag→name — with instant marking over some 170 countries',
  lead: 'The flags are drawn from ISO 3166-1 alpha-2 codes at runtime — every pair of regional-indicator letters is what renders a flag on your platform — so the data this quiz carries is plain text, and it works offline. Two directions: read a flag and choose the country, or read a name and pick the flag. Wrong options are always real countries, so a lucky guess still teaches something.',
  form: `<div class="tl-form">
  ${field('Direction', '<select id="fl-mode"><option value="name" selected>show the flag → pick the country</option><option value="flag">show the name → pick the flag</option></select>')}
  <button class="tl-btn primary" id="fl-go" type="button">New question ▶</button>
  <button class="tl-btn tl-opt" id="fl-a0" type="button" hidden></button>
  <button class="tl-btn tl-opt" id="fl-a1" type="button" hidden></button>
  <button class="tl-btn tl-opt" id="fl-a2" type="button" hidden></button>
  <button class="tl-btn tl-opt" id="fl-a3" type="button" hidden></button>
</div>
<div class="tl-res" id="fl-out">—</div>`,
  css: `[hidden]{display:none!important}.tl-opt{display:block;width:100%;text-align:left;margin-top:8px;padding:12px 16px;font-size:1.2rem}`,
  script: `
var $=function(id){return document.getElementById(id);};
var LIST='AD,Andorra;AE,United Arab Emirates;AF,Afghanistan;AG,Antigua and Barbuda;AL,Albania;AM,Armenia;AO,Angola;AR,Argentina;AT,Austria;AU,Australia;AZ,Azerbaijan;BA,Bosnia and Herzegovina;BB,Barbados;BD,Bangladesh;BE,Belgium;BF,Burkina Faso;BG,Bulgaria;BH,Bahrain;BI,Burundi;BJ,Benin;BN,Brunei;BO,Bolivia;BR,Brazil;BS,Bahamas;BT,Bhutan;BW,Botswana;BY,Belarus;BZ,Belize;CA,Canada;CD,DR Congo;CF,Central African Republic;CG,Congo;CH,Switzerland;CI,Ivory Coast;CL,Chile;CM,Cameroon;CN,China;CO,Colombia;CR,Costa Rica;CU,Cuba;CV,Cape Verde;CY,Cyprus;CZ,Czechia;DE,Germany;DJ,Djibouti;DK,Denmark;DM,Dominica;DO,Dominican Republic;DZ,Algeria;EC,Ecuador;EE,Estonia;EG,Egypt;ER,Eritrea;ES,Spain;ET,Ethiopia;FI,Finland;FJ,Fiji;FM,Micronesia;FR,France;GA,Gabon;GB,United Kingdom;GD,Grenada;GE,Georgia;GH,Ghana;GM,Gambia;GN,Guinea;GQ,Equatorial Guinea;GR,Greece;GT,Guatemala;GW,Guinea-Bissau;GY,Guyana;HN,Honduras;HR,Croatia;HT,Haiti;HU,Hungary;ID,Indonesia;IE,Ireland;IL,Israel;IN,India;IQ,Iraq;IR,Iran;IS,Iceland;IT,Italy;JM,Jamaica;JO,Jordan;JP,Japan;KE,Kenya;KG,Kyrgyzstan;KH,Cambodia;KI,Kiribati;KM,Comoros;KN,Saint Kitts and Nevis;KP,North Korea;KR,South Korea;KW,Kuwait;KZ,Kazakhstan;LA,Laos;LB,Lebanon;LI,Liechtenstein;LK,Sri Lanka;LR,Liberia;LS,Lesotho;LT,Lithuania;LU,Luxembourg;LV,Latvia;LY,Libya;MA,Morocco;MC,Monaco;MD,Moldova;ME,Montenegro;MG,Madagascar;MH,Marshall Islands;MK,North Macedonia;ML,Mali;MM,Myanmar;MN,Mongolia;MR,Mauritania;MT,Malta;MU,Mauritius;MV,Maldives;MW,Malawi;MX,Mexico;MY,Malaysia;MZ,Mozambique;NA,Namibia;NE,Niger;NG,Nigeria;NI,Nicaragua;NL,Netherlands;NO,Norway;NP,Nepal;NR,Nauru;NZ,New Zealand;OM,Oman;PA,Panama;PE,Peru;PG,Papua New Guinea;PH,Philippines;PK,Pakistan;PL,Poland;PT,Portugal;PW,Palau;PY,Paraguay;QA,Qatar;RO,Romania;RS,Serbia;RU,Russia;RW,Rwanda;SA,Saudi Arabia;SB,Solomon Islands;SC,Seychelles;SD,Sudan;SE,Sweden;SG,Singapore;SI,Slovenia;SK,Slovakia;SL,Sierra Leone;SM,San Marino;SN,Senegal;SO,Somalia;SR,Suriname;SS,South Sudan;ST,Sao Tome and Principe;SV,El Salvador;SY,Syria;SZ,Eswatini;TD,Chad;TH,Thailand;TJ,Tajikistan;TM,Turkmenistan;TN,Tunisia;TR,Turkey;TT,Trinidad and Tobago;TV,Tuvalu;TW,Taiwan;TZ,Tanzania;UA,Ukraine;UG,Uganda;US,United States;UY,Uruguay;UZ,Uzbekistan;VA,Vatican City;VE,Venezuela;VN,Vietnam;VU,Vanuatu;XK,Kosovo;YE,Yemen;ZA,South Africa;ZM,Zambia;ZW,Zimbabwe'.split(';').map(function(r){var p=r.split(',');return {c:p[0],n:p[1]};});
function flag(c){var A=127397;if(!String.fromCodePoint)return c;
 return String.fromCodePoint(A+c.charCodeAt(0),A+c.charCodeAt(1));}
var cur=null,okIdx=0,answered=false,made=0,score=0;
function others(except){var out=[],g=0;
 while(out.length<3&&g<300){var x=LIST[Math.floor(Math.random()*LIST.length)];g++;
  if(x.c!==except.c&&out.indexOf(x)<0)out.push(x);}
 return out;}
function shuf(a){var i,j,t;for(i=a.length-1;i>0;i--){j=Math.floor(Math.random()*(i+1));t=a[i];a[i]=a[j];a[j]=t;}return a;}
function newQ(){answered=false;cur=LIST[Math.floor(Math.random()*LIST.length)];
 var mode=$('fl-mode').value,all=others(cur);all.push(cur);all=shuf(all);okIdx=all.indexOf(cur);
 for(var i=0;i<4;i++){var b=$('fl-a'+i);b.hidden=false;
  b.textContent=mode==='flag'?flag(all[i].c)+' \u00b7 '+all[i].c:all[i].n;}
 $('fl-out').innerHTML='<div class="tl-big">'+(mode==='flag'?cur.n:flag(cur.c))+'</div><p class="meta">'
  +(mode==='flag'?'Tap the flag this country flies — the ISO letter pair shows through on platforms without flag art.':'Which country flies that flag?')
  +' Made '+made+' \u00b7 score '+score+'.</p>';}
function answer(i){if(answered)return;answered=true;made++;
 var ok=i===okIdx;if(ok)score++;
 $('fl-out').innerHTML='<span class="tl-badge '+(ok?'tl-ok':'tl-no')+'">'+(ok?'correct':'missed')+'</span> It was <b>'+cur.n+'</b> '+(flag(cur.c)!==cur.c?'· '+flag(cur.c):'')+'. Made '+made+' · score '+score+'. Press New question to keep going.';}
$('fl-go').onclick=newQ;$('fl-mode').onchange=newQ;
function bind(i){$('fl-a'+i).onclick=function(){answer(i);};}
bind(0);bind(1);bind(2);bind(3);
newQ();`,
  seo: `<h2 class="section-title">Why emoji flags look different everywhere</h2>
  <p>An emoji flag is not a picture — it is a two-letter ISO country code wearing a costume: each letter is a regional-indicator symbol, and platforms that draw flags pair them into artwork at render time. That is why the same question shows Nepal as a flag on a phone and as the letters NP on a desktop browser without flag fonts (Windows never drew flag glyphs at all). The quiz degrades honestly: when your platform will not paint the flag, the letter pair still identifies the country, and the answer text always names it either way.</p>`,
});

// ── 78. /alat/word-scramble — unscramble puzzles ────────────────────────
TOOLKIT.push({
  slug: 'word-scramble', ic: '🔤', name: 'Word Scramble',
  title: 'Word Scramble — Unjumble Letters Into Words | Tukuk-OS',
  desc: 'Unscramble jumbled words from four themed banks — animals, countries, food, sports — with letter hints and a running score. A classroom classic, in-browser.',
  hero: 'Word Scramble', sub: 'four word banks · letter hints · solved / tried score · endless rounds',
  navBlurb: 'Jumbled letters from themed word banks with progressive hints and a score — a warm-up game for spelling and vocabulary lessons.',
  hubBlurb: 'unjumble letters from animal, country, food or sport word banks, with hints that reveal one letter at a time',
  lead: 'The scramble is a true shuffle of the word (re-rolled until it differs from the answer), so every puzzle is solvable and none is accidentally pre-solved. Hint does what a teacher does: hands back one letter at a time, never more than all but the last, so the win still belongs to the player.',
  form: `<div class="tl-form">
  ${field('Word bank', '<select id="ws-cat"><option value="animals" selected>animals</option><option value="countries">countries</option><option value="food">food and drink</option><option value="sports">sports</option></select>')}
  ${field('Your guess', '<input id="ws-ans" type="text" autocomplete="off" spellcheck="false">')}
  <button class="tl-btn primary" id="ws-go" type="button">Check ✓</button>
  <button class="tl-btn" id="ws-hint" type="button">Hint: one letter</button>
  <button class="tl-btn" id="ws-new" type="button">New word ↷</button>
</div>
<div class="tl-res" id="ws-out">—</div>`,
  script: `
var $=function(id){return document.getElementById(id);};
var CATS={animals:'elephant,giraffe,zebra,penguin,dolphin,leopard,hamster,octopus,kangaroo,butterfly,crocodile,squirrel,flamingo,hedgehog,pelican,rabbit,turtle,panther',
 countries:'malaysia,indonesia,thailand,brazil,canada,france,germany,egypt,kenya,spain,italy,norway,peru,chile,morocco,vietnam,portugal,iceland,turkey,japan',
 food:'pineapple,dumpling,sandwich,spaghetti,avocado,burrito,pancake,noodles,cinnamon,chocolate,blueberry,omelette,pretzel,lasagna,papaya,hummus,risotto,tortilla',
 sports:'badminton,volleyball,cricket,surfing,cycling,archery,karate,sailing,skiing,rugby,boxing,fencing,rowing,tennis,climbing,skating,marathon,squash,judo,polo'};
var word='',scr='',hint=0,made=0,score=0;
function maskWord(){var i,out='';for(i=0;i<word.length;i++)out+=(i<hint?word.charAt(i):'_')+' ';return out.trim();}
function render(){ $('ws-out').innerHTML='<div class="tl-big">'+scr.split('').join(' ')+'</div>'
 +'<p class="meta">Progress: '+maskWord()+' · tried '+made+' · solved '+score+'. Type your guess and press Check, or take a hint.</p>';}
function pick(){var list=CATS[$('ws-cat').value].split(','),i,j,t,ch;
 word=list[Math.floor(Math.random()*list.length)];hint=0;
 ch=word.split('');
 for(i=0;i<20;i++){for(j=ch.length-1;j>0;j--){t=Math.floor(Math.random()*(j+1));var s2=ch[j];ch[j]=ch[t];ch[t]=s2;}
  scr=ch.join('');if(scr!==word||word.length<3)break;}
 $('ws-ans').value='';render();}
function check(){var v=$('ws-ans').value.trim().toLowerCase();
 if(!v){$('ws-out').innerHTML='<span class="tl-badge tl-no">empty</span> Type what the letters spell first.';return;}
 made++;
 if(v===word){score++;$('ws-out').innerHTML='<span class="tl-badge tl-ok">solved</span> <b>'+word+'</b> — that is the word. Tried '+made+' · solved '+score+'. Press New word for another.';}
 else{hint=Math.min(hint+1,word.length-1);
  $('ws-out').innerHTML='<span class="tl-badge tl-no">'+v+' is not it</span> A letter came back for free: '+maskWord()+' — tried '+made+' · solved '+score+'.';}
 $('ws-ans').value='';}
$('ws-go').onclick=check;
$('ws-hint').onclick=function(){hint=Math.min(hint+1,word.length-1);render();};
$('ws-new').onclick=pick;$('ws-cat').onchange=pick;
$('ws-ans').onkeydown=function(e){if(e&&e.key==='Enter')check();};
pick();`,
  seo: `<h2 class="section-title">Why the hint never gives the last letter</h2>
  <p>A puzzle solved by the machine teaches nothing and a puzzle surrendered to frustration teaches less; the useful edge is one letter short of the answer, which is where the rest of the word snaps into place on its own. That is why Hint caps at length minus one, and why wrong guesses reveal a letter too — the game is built to keep the player in the almost-solved zone rather than the solved-or-stuck binary.</p>`,
});

// ── 79. /alat/worksheet — printable practice sheets ────────────────────
TOOLKIT.push({
  slug: 'worksheet', ic: '📝', name: 'Worksheet Generator',
  title: 'Math Worksheet Generator — Printable Practice Sheets | Tukuk-OS',
  desc: 'Make printable arithmetic worksheets — add, subtract, multiply, divide or mixed — in three difficulty levels, with a toggleable answer key.',
  hero: 'Worksheet Generator', sub: '4 operations · 3 levels · 4–40 questions · answer key · print-ready',
  navBlurb: 'Printable arithmetic sheets with an answer key: pick the operation, the level and the count, then hit Print — no account, no watermark.',
  hubBlurb: 'print-ready arithmetic sheets in three levels with a one-click answer key — subtraction that never goes negative, division that always divides exact',
  lead: 'Built the way a teacher writes them at 11pm: pick addition, subtraction, times tables or exact division (or all four), choose a level, get a grid of fresh questions that prints cleanly — blank answers on the sheet, the key a click away. Subtractions never go below zero and divisions always come out exact, because a worksheet that produces negative answers at level 1 is not a worksheet but a trap.',
  form: `<div class="tl-form">
  ${field('Operation', '<select id="wh-op"><option value="add">addition</option><option value="sub">subtraction</option><option value="mul">multiplication</option><option value="div">division</option><option value="mixed" selected>mixed</option></select>')}
  ${field('Level', '<select id="wh-lv"><option value="1">1 · early practice</option><option value="2" selected>2 · confident</option><option value="3">3 · stretched</option></select>')}
  ${field('Questions', '<input id="wh-n" type="number" min="4" max="40" step="1" value="12">')}
  <button class="tl-btn primary" id="wh-go" type="button">Make worksheet</button>
  <button class="tl-btn" id="wh-key" type="button">Show answer key</button>
  <button class="tl-btn" id="wh-print" type="button">Print 🖨</button>
</div>
<div class="tl-res" id="wh-out">—</div>`,
  css: `.wh-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:4px 20px}.wh-item{padding:5px 0;border-bottom:1px dashed var(--line,#2c313c)}@media print{.tl-form,.tl-navchip,footer,.ad{visibility:hidden}.wh-item{border-bottom:1px solid #999}}`,
  script: `
var $=function(id){return document.getElementById(id);};
var PS=[],key=false;
function ri(n){return 1+Math.floor(Math.random()*n);}\n
function make(){var op=$('wh-op').value,lv=parseInt($('wh-lv').value,10)||2,
  n=Math.min(40,Math.max(4,parseInt($('wh-n').value,10)||12));
 PS=[];for(var i=0;i<n;i++){
  var o=(op==='mixed')?['add','sub','mul','div'][i%4]:op,a,b,qv;
  if(o==='add'){a=ri(lv===1?20:lv===2?100:1000);b=ri(lv===1?20:lv===2?100:1000);PS.push([a+' + '+b,a+b]);}
  else if(o==='sub'){a=ri(lv===1?20:lv===2?100:1000);b=ri(a);PS.push([a+' \u2212 '+b,a-b]);}
  else if(o==='mul'){var mx=lv===1?5:lv===2?10:20;a=ri(mx);b=ri(mx);PS.push([a+' \u00d7 '+b,a*b]);}
  else{b=ri(lv===1?5:lv===2?10:20);qv=ri(lv===1?5:lv===2?10:20);PS.push([b*qv+' \u00f7 '+b,qv]);}}
 key=false;$('wh-key').textContent='Show answer key';render();}
function render(){var i;
 function cell(p,ix){return '<div class="wh-item">'+(ix+1)+'. '+p[0]+' = '+(key?'<b>'+p[1]+'</b>':'&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;')+'</div>';}
 $('wh-out').innerHTML='<div class="wh-grid">'+PS.map(cell).join('')+'</div>'
  +'<p class="meta">'+PS.length+' questions · level '+$('wh-lv').value+' · '+(key?'answer key shown — press Hide to blank it again':'blank answers — print now or press the key')+'. Subtraction never goes negative; division is always exact.</p>';}
$('wh-go').onclick=make;
$('wh-key').onclick=function(){key=!key;$('wh-key').textContent=key?'Hide answer key':'Show answer key';render();};
$('wh-print').onclick=function(){try{window.print();}catch(e){$('wh-out').innerHTML+='<p class="meta">Printing is not available here — select the sheet and copy it instead.</p>';}};
make();`,
  seo: `<h2 class="section-title">Practice works when the answers are checkable</h2>
  <p>Every question on a sheet has exactly one right answer and the generator knows it the moment it writes the question — the pair is stored, not recomputed — which is why the key can never disagree with the sheet. Mixed sheets round-robin the four operations rather than drawing them at random, so a twenty-question sheet is five of each and no child spends the whole evening on the one thing they already own.</p>`,
});

// ── 80. /alat/spelling — fill-the-blank spelling ────────────────────
TOOLKIT.push({
  slug: 'spelling', ic: '🐝', name: 'Spelling Practice',
  title: 'Spelling Practice — Fill the Blank in Real Sentences | Tukuk-OS',
  desc: 'Practise spelling with words hidden inside sentences at three levels, with browser voice read-out, letter hints and instant marking.',
  hero: 'Spelling Practice', sub: 'sentence blanks · 3 levels · speak-it button · hint letters',
  navBlurb: 'Words hidden in sentences, spoken aloud by the browser voice when you want a hint by ear instead of by letter — three levels, marked instantly.',
  hubBlurb: 'fill the blank with the right spelling — sentences at three levels, a speak button, and letter hints that never hand over the whole word',
  lead: 'Spelling lives in context: the same sound can be written five ways, so the sentence does double duty — it fixes the meaning and forces the letter choice. Pick a level, read the line, type the missing word. The 🔊 button says the word out loud using the browser\u2019s own speech voice (nothing is downloaded), and hints surface one letter at a time.',
  form: `<div class="tl-form">
  ${field('Level', '<select id="sp-lv"><option value="easy">everyday (age 7+)</option><option value="mid" selected>tricky (age 10+)</option><option value="hard">commonly misspelt (age 12+)</option></select>')}
</div>
<div class="tl-res" id="sp-line">—</div>
<div class="tl-form">
  ${field('The missing word', '<input id="sp-in" type="text" autocomplete="off" spellcheck="false">')}
  <button class="tl-btn primary" id="sp-check" type="button">Check ✓</button>
  <button class="tl-btn" id="sp-say" type="button">🔊 Hear it</button>
  <button class="tl-btn" id="sp-hint" type="button">Hint: next letter</button>
  <button class="tl-btn" id="sp-new" type="button">Next word ▶</button>
</div>
<div class="tl-res" id="sp-out">—</div>`,
  script: `
var $=function(id){return document.getElementById(id);};
var L={easy:'cat|The @@ slept on the sofa.;dog|Our @@ buried a bone.;tree|A nest sat high in the @@.;book|She finished the whole @@.;milk|The @@ went sour.;bread|Torn @@ with butter.;frog|The @@ leapt off the log.;star|We wished on a @@.',
 mid:'because|We stayed in @@ it rained.;friend|My best @@ visits every summer.;school|The @@ bell rings at eight.;night|We counted stars all @@.;island|A ferry reaches the @@.;travel|We @@ light for the holidays.;weather|The @@ turned cold by noon.;country|Every @@ flies its own flag.',
 hard:'separate|@@ the eggs from the whites.;receive|You @@ the reply on Tuesday.;definite|She gave a @@ answer.;necessary|A coat is @@ in this weather.;embarrass|The spill @@ the whole class.;occurrence|Each @@ was written down.;rhythm|The @@ stuck in my head all day.;privilege|Reading is a @@, not a right.'};
var cur=['',''],hintN=0,made=0,score=0;
function mask(){var i,m='';for(i=0;i<cur[0].length;i++)m+=(i<hintN?cur[0].charAt(i):'_');return '<b>'+m+'</b>';}
function drawLine(){$('sp-line').innerHTML='<div class="tl-big">'+cur[1].replace('@@',mask())+'</div><p class="meta">The missing word has '+cur[0].length+' letters.</p>';}
function pick(){var arr=L[$('sp-lv').value].split(';');
 cur=arr[Math.floor(Math.random()*arr.length)].split('|');hintN=0;$('sp-in').value='';
 drawLine();$('sp-out').innerHTML='<span class="tl-badge">go</span> Type the word that fills the blank. Tried '+made+' · correct '+score+'.';}
function wrong(extra){hintN=Math.min(hintN+1,cur[0].length-1);drawLine();
 $('sp-out').innerHTML='<span class="tl-badge tl-no">not that spelling</span> '+(extra||'')+' A letter was revealed — keep going, or press Next word.';}
function check(){var v=$('sp-in').value.trim().toLowerCase();
 if(!v){$('sp-out').innerHTML='<span class="tl-badge tl-no">empty</span> Type the missing word first.';return;}
 made++;
 if(v===cur[0]){score++;$('sp-out').innerHTML='<span class="tl-badge tl-ok">spelt right</span> <b>'+cur[0]+'</b> — clean. Tried '+made+' · correct '+score+'. Next word when ready.';}
 else wrong(v+' is not it —');
}
$('sp-check').onclick=check;
$('sp-hint').onclick=function(){hintN=Math.min(hintN+1,cur[0].length-1);drawLine();};
$('sp-new').onclick=function(){var w=cur[0];
 if(w&&hintN>0&&$('sp-out').innerHTML.indexOf('tl-ok')<0){}pick();};
$('sp-say').onclick=function(){try{var u=new SpeechSynthesisUtterance(cur[0]);u.lang='en-GB';window.speechSynthesis.speak(u);}
 catch(e){$('sp-out').innerHTML='<span class="tl-badge tl-no">no voice here</span> This browser has no built-in speech — ask someone to read the sentence instead.';}};
$('sp-lv').onchange=pick;
$('sp-in').onkeydown=function(e){if(e&&e.key==='Enter')check();};
pick();`,
  seo: `<h2 class="section-title">Why the hard list is the right list</h2>
  <p>The level-three words are the ones large-scale spelling surveys keep finding wrong: separate, receive, definite, necessary — each missed for one specific reason. There is a hidden <i>par</i> in sep-ar-ate that keeps pulling the pen toward <i>-reth</i>; <i>receive</i> breaks the i-before-e rule because it is one of the rule's own exceptions; <i>definite</i> drops the <i>-able</i> people hear at its end; and <i>necessary</i> has exactly one pair (two c's, one s) where everyone feels there should be two pairs. Drilling random hard words spreads attention thin; drilling the champion misspellings concentrates it where the whole language actually trips.</p>`,
});

// ── 81. /alat/solar-system — planet fact cards ──────────────────────
TOOLKIT.push({
  slug: 'solar-system', ic: '🪐', name: 'Solar System Explorer',
  title: 'Solar System Explorer — Planet Facts and Comparisons | Tukuk-OS',
  desc: 'Fact cards for every planet, Pluto and the Sun: diameter versus Earth, orbit, day length, moons, gravity and temperature, from NASA figures.',
  hero: 'Solar System Explorer', sub: '9 planets + Pluto + the Sun · size vs Earth · NASA fact-sheet numbers',
  navBlurb: 'Every planet, the dwarf Pluto and the Sun itself: size against Earth, orbit, day, moons, gravity and temperature — rounded NASA fact-sheet data.',
  hubBlurb: 'pick a world and get its real numbers — diameter against Earth, its year and day, moons, gravity and temperature — plus one strange fact',
  lead: 'A select box of ten worlds and a card of honest numbers for each: diameter in kilometres and as a multiple of Earth, distance in astronomical units, year and day in Earth measures, moons as counted today, surface gravity and mean temperature. The figures are rounded values from the NASA planetary fact sheets, and each body carries the one fact that makes it worth remembering.',
  form: `<div class="tl-form">
  ${field('Choose a world', '<select id="so-p"><option value="0">Mercury</option><option value="1">Venus</option><option value="2" selected>Earth</option><option value="3">Mars</option><option value="4">Jupiter</option><option value="5">Saturn</option><option value="6">Uranus</option><option value="7">Neptune</option><option value="8">Pluto (dwarf planet)</option><option value="9">The Sun</option></select>')}
</div>
<div class="tl-res" id="so-out">—</div>`,
  css: `.so-bar{height:10px;border-radius:5px;background:linear-gradient(90deg,#4c8dff,#7fd0ff);margin:2px 0 10px}`,
  script: `
var $=function(id){return document.getElementById(id);};
var P=[['Mercury',4879,0.39,88,1406,0,0.38,167,'A year takes 88 Earth days and the surface swings some 600 degrees between daylight and dark.'],
['Venus',12104,0.72,225,5832,0,0.90,464,'Its day is longer than its year, and it turns backwards under clouds of sulphuric acid.'],
['Earth',12742,1.00,365.25,24,1,1.00,15,'The only world known to carry liquid-water oceans — and, so far, the only one known to carry readers.'],
['Mars',6779,1.52,687,24.7,2,0.38,-65,'Home to Olympus Mons, a volcano nearly three times the height of Everest, and to dust storms that wrap the whole planet.'],
['Jupiter',139820,5.20,4333,9.9,95,2.53,-110,'The Great Red Spot is a storm wider than Earth that has outlasted every telescope aimed at it.'],
['Saturn',116460,9.58,10759,10.7,146,1.07,-140,'Its rings are mostly water ice, and thin: you could stack forty of them through like records.'],
['Uranus',50724,19.2,30687,17.2,28,0.89,-195,'Tipped on its side by an ancient collision, it rolls around the Sun like a dropped marble.'],
['Neptune',49244,30.05,60190,16.1,16,1.14,-200,'Winds here top 2,000 km/h — the fastest measured anywhere in the solar system.'],
['Pluto',2377,39.5,90560,153.3,5,0.07,-229,'Reclassified in 2006, it keeps a heart-shaped glacier of nitrogen ice as its signature.'],
['The Sun',1392700,0,0,609,0,27.9,5500,'A middle-aged star holding 99.8% of the solar system mass — everything else on this list orbits it.']];
function fmt(n){return String(n).replace(/\\B(?=(\\d{3})+(?!\\d))/g,',');}
function render(){var e=P[parseInt($('so-p').value,10)],d=e[1],w=Math.max(3,Math.min(100,Math.round(d/1392700*100)));
 var h='<div class="tl-big">'+e[0]+'</div>'
 +'<p class="meta">Diameter, to scale against the Sun: '+w+'%</p><div class="so-bar" style="width:'+w+'%"></div>'
 +'<table class="tl-tab"><tbody>'
 +'<tr><td>Diameter</td><td>'+fmt(d)+' km · '+(d/12742).toFixed(2)+'× Earth</td></tr>'
 +'<tr><td>Distance from the Sun</td><td>'+(e[2]?(e[2]+' AU · about '+fmt(Math.round(e[2]*150))+' million km'):'— it is the Sun')+'</td></tr>'
 +'<tr><td>Year (Earth days)</td><td>'+(e[3]?fmt(e[3]):'—')+'</td></tr>'
 +'<tr><td>Day (Earth hours)</td><td>'+(e[4]===5832?'5,832 (= 243 Earth days, retrograde)':e[4])+'</td></tr>'
 +'<tr><td>Known moons</td><td>'+(e[0]==='The Sun'?'—':e[5])+'</td></tr>'
 +'<tr><td>Surface gravity</td><td>'+e[6]+'× Earth</td></tr>'
 +'<tr><td>Mean temperature</td><td>'+e[7]+' °C</td></tr>'
 +'</tbody></table><p class="meta">'+e[8]+'</p>'
 +'<p class="meta">Rounded values from the NASA planetary fact sheets; moon counts are the confirmed totals as of 2026. Venus and Uranus rotate backwards — their day figures are still the true spin period.</p>';
 $('so-out').innerHTML=h;}
$('so-p').onchange=render;render();`,
  seo: `<h2 class="section-title">Why the day of Venus is written two ways</h2>
  <p>Astronomers count a sidereal day (one full spin against the stars) and a solar day (sunrise to sunrise), and near the Sun the two differ by a year's worth of orbital motion. Venus spins so slowly — 243 Earth days sidereal, and a day longer than its 225-day year — that its rotation genuinely loses the race against its orbit, which is the sort of fact a card like this exists to make one click away.</p>`,
});

// ── 82. /alat/study-planner — spaced revision calendar ────────────────
TOOLKIT.push({
  slug: 'study-planner', ic: '📅', name: 'Study Planner',
  title: 'Spaced Study Planner — Revision Calendar to Your Exam | Tukuk-OS',
  desc: 'Give it your exam date and get a spaced-repetition revision calendar: sessions at doubling intervals, printed with weekdays and hour totals.',
  hero: 'Study Planner', sub: 'exam date → doubling-gap revision days · weekday labels · hour budget',
  navBlurb: 'Type the exam date and get the revision calendar: first pass today, recalls at 1, 2, 4, 8 days, the night before capped — pure spacing maths.',
  hubBlurb: 'turn any exam date into a spaced-revision calendar — sessions at doubling gaps, weekdays printed, total hours budgeted',
  lead: 'Spacing is the cheapest grade-raiser in the research: the same hours, spread across doubling gaps (1, 2, 4, 8, 16 days), beat double the hours in one week. This planner takes the exam date, works out how many days of runway there are, and lays the sessions on the doubling schedule — first pass today, final recall the night before, nothing after the deadline.',
  form: `<div class="tl-form">
  ${field('Exam / test day', '<input id="pl-exam" type="date">')}
  ${field('Hours per session', '<input id="pl-hrs" type="number" min="1" max="8" step="1" value="2">')}
  <button class="tl-btn primary" id="pl-go" type="button">Plan my revision</button>
</div>
<div class="tl-res" id="pl-out">—</div>`,
  script: `
var $=function(id){return document.getElementById(id);};
var DAYS=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
var MON=['January','February','March','April','May','June','July','August','September','October','November','December'];
function iso(d){var m=d.getMonth()+1,dd=d.getDate();return d.getFullYear()+'-'+(m<10?'0':'')+m+'-'+(dd<10?'0':'')+dd;}
function shift(d,n){var x=new Date(d.getTime());x.setDate(x.getDate()+n);return x;}
function nice(d){return DAYS[d.getDay()]+', '+d.getDate()+' '+MON[d.getMonth()];}
function plan(){var v=$('pl-exam').value,today=new Date();today.setHours(0,0,0,0);
 if(!v){var t=shift(today,30);$('pl-exam').value=iso(t);v=iso(t);}
 var p=v.split('-'),exam=new Date(+p[0],+p[1]-1,+p[2]);
 var total=Math.round((exam-today)/86400000);
 if(!(total>0)){$('pl-out').innerHTML='<span class="tl-badge tl-no">not enough runway</span> Pick a date from tomorrow onward — spacing needs days to work with.';return;}
 var offs=[0,1,2,4,8,16,32,64],use=[],i;
 for(i=0;i<offs.length&&offs[i]<total;i++)use.push(offs[i]);
 if(use[use.length-1]!==total-1)use.push(total-1);
 var hrs=parseInt($('pl-hrs').value,10)||2,rows='';
 for(i=0;i<use.length;i++){var d=shift(today,use[i]),label;
  if(i===0)label='First pass — read, summarise, make the cards';
  else if(use[i]===total-1)label='Final recall — cards only, no new material';
  else label='Recall pass '+(i+1)+' — active recall before any re-reading';
  rows+='<tr><td>'+nice(d)+'</td><td>'+label+'</td><td>'+hrs+' h</td></tr>';}
 $('pl-out').innerHTML='<div class="tl-big">'+use.length+' sessions · '+nice(today)+' → '+nice(exam)+'</div>'
  +'<table class="tl-tab"><thead><tr><th>Day</th><th>What to do</th><th>Time</th></tr></thead><tbody>'+rows+'</tbody></table>'
  +'<p class="meta">The gaps double (1, 2, 4, 8 days…) so each recall lands just as forgetting starts — that is where repetition earns its keep. Total budget: '+(hrs*use.length)+' hours. If that beats your free time, cut hours per session, never the spacing.</p>';}
$('pl-go').onclick=plan;$('pl-exam').onchange=plan;$('pl-hrs').onchange=plan;plan();`,
  seo: `<h2 class="section-title">What the research actually found</h2>
  <p>Distributed practice — the same material met across spread-out days — is among the most replicated effects in learning research, and it holds even when the total study time is cut. The doubling schedule is not a rule from one paper; it is the shape most spaced-repetition systems converge on, because memory decays roughly exponentially and gaps that double stay one step ahead of the curve. A planner cannot make anyone study; it only decides whether the hours they spend are worth double.</p>`,
});

// ── 83. /alat/word-guess — hangman without the gallows ───────────────
TOOLKIT.push({
  slug: 'word-guess', ic: '🎯', name: 'Word Guess',
  title: 'Word Guess — Hangman-Style Letter Game | Tukuk-OS',
  desc: 'Guess the hidden word one letter at a time from themed banks, six lives, no gallows. Keeps a running win-loss score. One screen, in-browser.',
  hero: 'Word Guess', sub: '3 word banks · 26 letter keys · six lives · win-loss tally',
  navBlurb: 'The classroom hangman with the gallows taken out: themed word banks, six lives, a full keyboard of letter keys and a running score.',
  hubBlurb: 'guess the hidden word letter by letter — six lives, themed banks and a full alphabet of keys, score kept across rounds',
  lead: 'The same game every teacher runs on the whiteboard, with the rope-and-stick part removed: a hidden word from a themed bank, twenty-six letter keys that grey out once used, six lives, and a win-loss tally that keeps the class honest about the streak. Every word in the banks is lowercase, singular and unhyphenated.',
  form: `<div class="tl-form">
  ${field('Word bank', '<select id="wg-cat"><option value="animals" selected>animals</option><option value="countries">countries</option><option value="food">food and drink</option></select>')}
</div>
<div class="tl-keys">${'abcdefghijklmnopqrstuvwxyz'.split('').map(function(c){return '<button type="button" class="tl-btn tl-key" id="wg-'+c+'">'+c+'</button>';}).join('')}</div>
<div class="tl-form">
  <button class="tl-btn primary" id="wg-new" type="button">New word ↷</button>
</div>
<div class="tl-res" id="wg-out">—</div>`,
  css: `.tl-keys{display:flex;flex-wrap:wrap;gap:6px;margin:12px 0}.tl-key{min-width:36px;padding:8px 10px;text-transform:uppercase;font-size:.95rem}.tl-key[disabled]{opacity:.3;cursor:default}`,
  script: `
var $=function(id){return document.getElementById(id);};
var CATS={animals:'elephant giraffe zebra penguin dolphin leopard hamster octopus kangaroo butterfly crocodile squirrel flamingo hedgehog pelican rabbit turtle panther'.split(' '),
 countries:'malaysia indonesia thailand brazil canada france germany egypt kenya spain italy norway peru chile morocco vietnam portugal iceland turkey japan'.split(' '),
 food:'pineapple dumpling sandwich spaghetti avocado burrito pancake noodles cinnamon chocolate blueberry omelette pretzel lasagna papaya hummus risotto tortilla'.split(' ')};
var word='',guessed='',misses=[],wins=0,losses=0;
function isWon(){var i;for(i=0;i<word.length;i++)if(guessed.indexOf(word.charAt(i))<0)return false;return true;}
function display(){var i,out='';for(i=0;i<word.length;i++)out+=(guessed.indexOf(word.charAt(i))>=0?word.charAt(i):'_')+' ';return out.trim();}
function hearts(){var i,s='';for(i=0;i<6-misses.length;i++)s+='♥';for(i=0;i<misses.length;i++)s+='·';return s;}
function render(){var dead=misses.length>=6;
 var h='<div class="tl-big">'+display()+'</div><p class="meta">'+hearts()+' · '+Math.max(0,6-misses.length)+' lives left';
 if(misses.length)h+=' · wrong: '+misses.join(' ');
 h+=' · wins '+wins+' · losses '+losses+'</p>';
 if(dead)h+='<p class="meta"><span class="tl-badge tl-no">lost it</span> The word was <b>'+word+'</b>. Press New word for the next round.</p>';
 else if(isWon())h+='<p class="meta"><span class="tl-badge tl-ok">solved</span> <b>'+word+'</b> with '+(6-misses.length)+' lives to spare. Press New word.</p>';
 $('wg-out').innerHTML=h;}
function pick(){var list=CATS[$('wg-cat').value];
 word=list[Math.floor(Math.random()*list.length)];guessed='';misses=[];
 var i;for(i=0;i<26;i++){var b=document.getElementById('wg-'+String.fromCharCode(97+i));if(b)b.disabled=false;}
 render();}
function hit(ch){if(misses.length>=6||isWon())return;
 if(guessed.indexOf(ch)>=0||misses.indexOf(ch)>=0)return;
 if(word.indexOf(ch)>=0)guessed+=ch;else misses.push(ch);
 var b=document.getElementById('wg-'+ch);if(b)b.disabled=true;
 if(misses.length>=6)losses++;else if(isWon())wins++;
 render();}
var AZ='abcdefghijklmnopqrstuvwxyz',i0;
for(i0=0;i0<26;i0++){(function(ch){var b=document.getElementById('wg-'+ch);if(b)b.onclick=function(){hit(ch);};})(AZ.charAt(i0));}
$('wg-new').onclick=pick;$('wg-cat').onchange=pick;pick();`,
  seo: `<h2 class="section-title">Why letter frequency is a real strategy</h2>
  <p>E, T, A, O, I, N — in English text the eight most common letters cover roughly two thirds of all occurrences, which is why the player who opens with them wins more than the one hunting for favourite letters. Against this game's banks the same advice holds with one tweak: every word is lowercase, singular and unhyphenated, so vowels-first openings are almost always right, and a first guess of Q or Z is a life spent shopping.</p>`,
});

module.exports = { TOOLKIT, toolkitPage, navItems, hubLines, sitemapPaths };
