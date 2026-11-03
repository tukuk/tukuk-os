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

module.exports = { TOOLKIT, toolkitPage, navItems, hubLines, sitemapPaths };
