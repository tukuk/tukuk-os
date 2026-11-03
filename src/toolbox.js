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

module.exports = { TOOLKIT, toolkitPage, navItems, hubLines, sitemapPaths };
