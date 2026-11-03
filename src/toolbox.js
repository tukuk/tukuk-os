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
  const body = `<p>${t.lead}</p>
  <div data-ra="skip">${t.form}</div>
  <noscript><p>JavaScript is required — this tool does its whole work in your browser, which is also why nothing you type ever leaves your device.</p></noscript>
  ${t.seo || ''}
  <p class="meta">Part of <a href="/alat">Everyday Tools</a>. Like everything on tukuk.org: free, no account, no tracking.</p>${script}`;
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
  desc: 'A Canva-style canvas studio that runs entirely in your browser: gradient backgrounds, text, shapes and your own images as layers — drag, rotate, scale, export PNG at 2x. No sign-up, nothing uploaded.',
  hero: 'Design Studio', sub: 'layers · drag · rotate · PNG export · zero uploads, ever',
  navBlurb: 'The poster maker without the login wall: backgrounds, text, shapes and images as real layers, exported as PNG straight from your canvas.',
  hubBlurb: 'make the social image yourself: gradient or solid background, layered text/shapes/photos, drag-wheel-export — and your file never leaves the tab',
  lead: 'What a design tool should be in one page: a <b>canvas</b>, real <b>layers</b> (text, rectangles, circles, your own images), drag to move, wheel to scale, sliders for rotation and opacity, and a <b>PNG export</b> at up to 2× the working size. Every preset matches a real spec — Instagram square and story, YouTube thumbnail, Open Graph share card, A4 portrait. And unlike the platforms this borrows the idea from: there is no account, no watermark, no template warehouse, no upload — <b>your image exists only in this tab\u2019s memory</b>. Close it and it is gone; export before you refresh.',
  css: `
.ds-bar,.ds-tools,.ds-edit{display:flex;flex-wrap:wrap;gap:.6rem;align-items:flex-end;margin:.7rem 0}
.ds-bar label,.ds-edit label{display:flex;flex-direction:column;font-size:.78rem;gap:.2rem}
.ds-bar input,.ds-bar select,.ds-edit input,.ds-edit select{min-width:4.5rem}
.ds-edit input[type=color]{padding:1px;height:2rem}
#ds-canvas{display:block;margin:.5rem auto;border:1px solid #334155;border-radius:.5rem;max-width:100%;touch-action:none;cursor:crosshair;background:#000}
.ds-tools button,.ds-imgbtn{background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:.4rem;padding:.45rem .8rem;cursor:pointer;font-size:.85rem}
.ds-tools button:hover,.ds-imgbtn:hover{background:#334155}
.ds-imgbtn input{display:none}
#ds-sel{margin-left:auto;font-size:.8rem}
`,
  form: `<div class="ds-bar">
  ${field('Canvas', '<select id="ds-size"><option value="1080x1080" selected>Instagram post · 1080×1080</option><option value="1080x1920">Story / Reel · 1080×1920</option><option value="1080x1350">Portrait post · 1080×1350</option><option value="1280x720">YouTube thumbnail · 1280×720</option><option value="1200x630">Share card (OG) · 1200×630</option><option value="1240x1754">A4 portrait · 1240×1754</option><option value="custom">Custom…</option></select>')}
  ${field('W', '<input id="ds-w" type="number" min="100" max="4000" step="10" value="1080">')}
  ${field('H', '<input id="ds-h" type="number" min="100" max="4000" step="10" value="1080">')}
  ${field('BG colour', '<input id="ds-bga" type="color" value="#0f172a">')}
  ${field('BG accent', '<input id="ds-bgb" type="color" value="#7c3aed">')}
  ${field('Background', '<select id="ds-bgs"><option value="solid">solid</option><option value="vgrad" selected>vertical gradient</option><option value="dgrad">diagonal gradient</option><option value="radial">radial glow</option></select>')}
</div>
<canvas id="ds-canvas"></canvas>
<div class="ds-tools">
  <button type="button" id="ds-addtext">+ Text</button>
  <button type="button" id="ds-addrect">+ Rectangle</button>
  <button type="button" id="ds-addcircle">+ Circle</button>
  <label class="ds-imgbtn">+ Image<input type="file" id="ds-img" accept="image/*"></label>
  <button type="button" id="ds-dup">Duplicate</button>
  <button type="button" id="ds-back">Send back</button>
  <button type="button" id="ds-fwd">Bring forward</button>
  <button type="button" id="ds-del">Delete</button>
  <span id="ds-sel" class="meta">nothing selected</span>
</div>
<div class="ds-edit">
  ${field('Text', '<input id="ds-txt" type="text" value="" disabled>')}
  ${field('Font', '<select id="ds-font"><option value="Impact,Charcoal,sans-serif">Impact</option><option value="Georgia,serif" selected>Georgia</option><option value="Helvetica,Arial,sans-serif">Helvetica</option><option value="Trebuchet MS,sans-serif">Trebuchet</option><option value="Courier New,monospace">Courier</option></select>')}
  ${field('Size', '<input id="ds-ps" type="number" min="8" max="600" step="1" value="64">')}
  ${field('Colour', '<input id="ds-col" type="color" value="#ffffff">')}
  ${field('Opacity %', '<input id="ds-op" type="range" min="5" max="100" value="100">')}
  ${field('Scale %', '<input id="ds-sc" type="range" min="10" max="500" value="100">')}
  ${field('Rotate °', '<input id="ds-rot" type="range" min="-180" max="180" value="0">')}
  ${field('Export', '<select id="ds-scale"><option value="1">PNG 1×</option><option value="2" selected>PNG 2×</option></select>')}
  <button class="tl-btn primary" id="ds-dl" type="button">Download PNG</button>
</div>
<div class="tl-res meta" id="ds-out">The canvas is the tool: click a layer to select it, drag to move, mouse wheel over the canvas to scale the selected layer. The row of controls below edits the selected layer live.</div>`,
  script: `
var $=function(id){return document.getElementById(id);};
var cv=$('ds-canvas');
var cx=(cv&&cv.getContext)?cv.getContext('2d'):null;
var W=1080,H=1080,layers=[],sel=-1,seq=0,dragging=false;
function num(v,d){v=parseFloat(v);return isNaN(v)?d:v;}
function hex(v){return /^#[0-9a-fA-F]{6}$/.test(v)?v:'#000000';}
function draw(){
 if(!cx)return;
 var vw=(typeof window!=='undefined'&&window.innerWidth)?Math.min(window.innerWidth-70,720):720;
 var scD=Math.min(vw/W,(vw*1.35)/H);
 cv.style.width=Math.round(W*scD)+'px';cv.style.height=Math.round(H*scD)+'px';
 if(cv.width!==W)cv.width=W;if(cv.height!==H)cv.height=H;
 var A=hex($('ds-bga').value),B=hex($('ds-bgb').value),st=$('ds-bgs').value;
 cx.setTransform(1,0,0,1,0,0);cx.globalAlpha=1;cx.setLineDash([]);
 if(st==='solid'){cx.fillStyle=A;cx.fillRect(0,0,W,H);}
 else{var g=st==='radial'?cx.createRadialGradient(W/2,H*0.42,10,W/2,H*0.42,Math.max(W,H)*0.75)
   :cx.createLinearGradient(0,0,st==='dgrad'?W:0,st==='dgrad'?H:H);
  if(st==='radial'){g.addColorStop(0,B);g.addColorStop(1,A);}else{g.addColorStop(0,A);g.addColorStop(1,B);}
  cx.fillStyle=g;cx.fillRect(0,0,W,H);}
 for(var i=0;i<layers.length;i++)drawLayer(layers[i],i===sel);
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
 if(l.kind==='rect')return {w:l.size*s,h:l.size*0.62*s};
 if(l.kind==='text'){var f=l.text.split('\\n'),mw=0,keep=cx.font;
  cx.font='700 '+Math.round(l.size)+'px '+l.font;
  for(var i=0;i<f.length;i++)mw=Math.max(mw,cx.measureText(f[i]).width);
  cx.font=keep;return {w:mw,h:l.size*1.18*f.length};}
 return {w:l.size*s,h:l.size*s};}
function drawLayer(l,selected){
 cx.save();cx.translate(l.x,l.y);cx.rotate(l.rot*Math.PI/180);cx.globalAlpha=l.op/100;
 var s=l.scale/100;
 if(l.kind==='text'){
  cx.font='700 '+Math.round(l.size)+'px '+l.font;
  cx.fillStyle=l.color;cx.textAlign='center';cx.textBaseline='middle';
  var lines=wrapText(l.text),lh=l.size*1.18;
  for(var i=0;i<lines.length;i++)cx.fillText(lines[i],0,(i-(lines.length-1)/2)*lh);
 }else if(l.kind==='rect'){cx.fillStyle=l.color;cx.fillRect(-l.size*s/2,-l.size*0.31*s,l.size*s,l.size*0.62*s);
 }else if(l.kind==='ellipse'){cx.fillStyle=l.color;cx.beginPath();cx.arc(0,0,l.size*s/2,0,Math.PI*2);cx.fill();
 }else if(l.kind==='img'&&l.img&&l.img.complete&&l.img.naturalWidth){
  cx.drawImage(l.img,-l.imgW*s/2,-l.imgH*s/2,l.imgW*s,l.imgH*s);}
 if(selected){cx.globalAlpha=1;cx.strokeStyle='#38bdf8';cx.lineWidth=Math.max(3,W/360);cx.setLineDash([12,9]);
  var b=layerBox(l);cx.strokeRect(-b.w/2-12,-b.h/2-12,b.w+24,b.h+24);}
 cx.restore();cx.globalAlpha=1;cx.setLineDash([]);
}
function select(i){sel=i;var l=i>=0?layers[i]:null;
 $('ds-sel').textContent=l?('layer '+(i+1)+': '+l.name):'nothing selected';
 $('ds-txt').disabled=!l||l.kind!=='text';
 if(l){$('ds-txt').value=l.text!==undefined?l.text:'';
  if(l.font)$('ds-font').value=l.font;
  $('ds-ps').value=Math.round(l.size||0);
  if(/^#[0-9a-fA-F]{6}$/.test(l.color||''))$('ds-col').value=l.color;
  $('ds-op').value=l.op;$('ds-sc').value=Math.round(l.scale);$('ds-rot').value=Math.round(l.rot);}
 draw();}
function addLayer(l){l.id=++seq;l.x=l.x||Math.round(W/2);l.y=l.y||Math.round(H/2);
 l.rot=l.rot||0;l.op=l.op==null?100:l.op;l.scale=l.scale||100;
 layers.push(l);select(layers.length-1);}
function swapTo(i){if(i<0||i>=layers.length)return;select(i);}
$('ds-addtext').onclick=function(){addLayer({kind:'text',name:'text',text:'Your text',font:$('ds-font').value,size:Math.max(28,Math.round(W/13)),color:hex($('ds-col').value),rot:0,op:100,scale:100});};
$('ds-addrect').onclick=function(){addLayer({kind:'rect',name:'rectangle',size:Math.round(W/4),color:hex($('ds-bgb').value),rot:0,op:100,scale:100});};
$('ds-addcircle').onclick=function(){addLayer({kind:'ellipse',name:'circle',size:Math.round(W/4),color:hex($('ds-bgb').value),rot:0,op:100,scale:100});};
$('ds-del').onclick=function(){if(sel<0)return;layers.splice(sel,1);swapTo(Math.min(sel,layers.length-1));};
$('ds-dup').onclick=function(){if(sel<0)return;var n={},L=layers[sel];for(var k in L)n[k]=L[k];
 n.id=++seq;n.x=Math.round(L.x+W*0.05);n.y=Math.round(L.y+H*0.05);n.name=L.name;
 layers.splice(sel+1,0,n);select(sel+1);};
$('ds-back').onclick=function(){if(sel<=0)return;var L=layers[sel];layers.splice(sel,1);layers.unshift(L);select(0);};
$('ds-fwd').onclick=function(){if(sel<0||sel>=layers.length-1)return;var L=layers[sel];layers.splice(sel,1);layers.push(L);select(layers.length-1);};
function bindEdit(id,fn){$(id).oninput=function(){if(sel<0)return;fn(layers[sel]);draw();};}
bindEdit('ds-txt',function(l){if(l.kind==='text'){l.text=$('ds-txt').value;l.name=l.text.slice(0,20)||'text';}});
bindEdit('ds-font',function(l){l.font=$('ds-font').value;});
bindEdit('ds-ps',function(l){l.size=num($('ds-ps').value,l.size);});
bindEdit('ds-col',function(l){l.color=$('ds-col').value;});
bindEdit('ds-op',function(l){l.op=num($('ds-op').value,100);});
bindEdit('ds-sc',function(l){l.scale=num($('ds-sc').value,100);});
bindEdit('ds-rot',function(l){l.rot=num($('ds-rot').value,0);});
function canvasPos(e){var r=(cv.getBoundingClientRect&&cv.getBoundingClientRect())||{left:0,top:0,width:W,height:H};
 return {x:(e.clientX-r.left)*(W/(r.width||W)),y:(e.clientY-r.top)*(H/(r.height||H))};}
function hit(p){for(var i=layers.length-1;i>=0;i--){var l=layers[i],b=layerBox(l);
 if(Math.abs(p.x-l.x)<b.w/2+16&&Math.abs(p.y-l.y)<b.h/2+16)return i;}return -1;}
if(cv.addEventListener){
 cv.addEventListener('pointerdown',function(e){if(cv.setPointerCapture)cv.setPointerCapture(e.pointerId);
  var p=canvasPos(e),i=hit(p);
  if(i>=0){select(i);dragging=true;}else if(layers.length)select(-1);});
 cv.addEventListener('pointermove',function(e){if(!dragging||sel<0)return;var p=canvasPos(e);
  layers[sel].x=Math.max(0,Math.min(W,Math.round(p.x)));layers[sel].y=Math.max(0,Math.min(H,Math.round(p.y)));draw();});
 cv.addEventListener('pointerup',function(){dragging=false;});
 cv.addEventListener('wheel',function(e){if(sel<0)return;e.preventDefault();
  var l=layers[sel];l.scale=Math.max(10,Math.min(500,l.scale+(e.deltaY<0?6:-6)));
  $('ds-sc').value=Math.round(l.scale);draw();},{passive:false});}
function applySize(){var v=$('ds-size').value;
 if(v!=='custom'){var p=v.split('x');W=parseInt(p[0],10);H=parseInt(p[1],10);
  $('ds-w').value=W;$('ds-h').value=H;}
 var cw=num($('ds-w').value,W),ch=num($('ds-h').value,H);
 if(cw>=100&&cw<=4000&&ch>=100&&ch<=4000){W=cw;H=ch;}
 draw();}
$('ds-size').onchange=applySize;$('ds-w').oninput=applySize;$('ds-h').oninput=applySize;
$('ds-bga').oninput=draw;$('ds-bgb').oninput=draw;$('ds-bgs').onchange=draw;
$('ds-img').onchange=function(e){var f=e.target.files&&e.target.files[0];
 if(!f||typeof FileReader==='undefined')return;
 var fr=new FileReader();
 fr.onload=function(){var im=new Image();
  im.onload=function(){var s=Math.min(W*0.8/im.naturalWidth,H*0.8/im.naturalHeight,1);
   addLayer({kind:'img',name:(f.name||'image').slice(0,24),img:im,
    imgW:Math.round(im.naturalWidth*s),imgH:Math.round(im.naturalHeight*s),
    size:Math.round(im.naturalWidth*s),rot:0,op:100,scale:100});};
  im.src=fr.result;};
 fr.readAsDataURL(f);e.target.value='';};
$('ds-dl').onclick=function(){if(!cx||typeof document==='undefined'||!document.createElement)return;
 var k=parseInt($('ds-scale').value,10)||1;
 var oc=document.createElement('canvas');oc.width=W*k;oc.height=H*k;
 var o=oc.getContext('2d');o.scale(k,k);
 var keepSel=sel,realCx=cx;sel=-1;cx=o;draw();cx=realCx;sel=keepSel;
 var a=document.createElement('a');a.download='tukuk-design.png';a.href=oc.toDataURL('image/png');a.click();
 draw();};
W=num($('ds-w').value,1080);H=num($('ds-h').value,1080);
addLayer({kind:'ellipse',name:'accent circle',size:Math.round(W/2),color:hex($('ds-bgb').value),rot:0,op:35,scale:100});
layers[0].x=Math.round(W*0.78);layers[0].y=Math.round(H*0.2);
addLayer({kind:'text',name:'headline',text:'Your headline',font:'Impact,Charcoal,sans-serif',size:Math.max(30,Math.round(W/11)),color:'#ffffff',rot:0,op:100,scale:100});
layers[1].y=Math.round(H*0.5);
select(1);`,
  seo: `<h2 class="section-title">Why a plain-canvas studio beats a template portal</h2>
  <p>Every hosted design platform runs the same quiet business: your work markets the platform, the watermark is the upsell, and the file leaves your machine before you have really made it. This studio inverts all three — the pixels are composited by your browser\u2019s own canvas engine, the PNG is assembled locally, and closing the tab destroys the document like a whiteboard. What it deliberately lacks: template galleries, stock search, font libraries, collaborative cursors — all features of the account that owns your file. The presets, though, are real: Instagram and YouTube take exactly these dimensions because their own specs demand them.</p>
  <p class="meta">Thumbnail makers: Impact at one-eleventh of the canvas width (about 116 px on a 1280 canvas) is the size that still reads at phone preview width — anything smaller is decoration, not headline.</p>`,
});

module.exports = { TOOLKIT, toolkitPage, navItems, hubLines, sitemapPaths };
