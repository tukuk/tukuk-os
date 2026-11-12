const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', 'content', 'blog');

const categories = [
  { name: 'Sains & Angkasa', tags: 'sains, angkasa, astronomi, fizik' },
  { name: 'Seni Bina & Bandar', tags: 'seni-bina, bandar, geografi, infrastruktur' },
  { name: 'Sejarah & Tamadun', tags: 'sejarah, tamadun, arkeologi, dunia' },
  { name: 'Sains Komputer & Algoritma', tags: 'sains-komputer, algoritma, pengaturcaraan, data' },
  { name: 'Ekonomi & Perniagaan', tags: 'ekonomi, perniagaan, pasaran, kewangan' }
];

const topics = [
  'Mekanisme Kuantum', 'Evolusi Bahasa Pengaturcaraan', 'Seni Bina Mikroservis', 'Sejarah Pemetaan Global',
  'Tenaga Boleh Diperbaharui', 'Kriptografi Kunci Awam', 'Struktur Data Lanjutan', 'Ekonomi Tingkah Laku',
  'Sistem Satelit Navigasi', 'Pengurusan Pangkalan Data Relasi', 'Fizik Zarah Asas', 'Pengkomputeran Awan Teragih',
  'Sejarah Revolusi Perindustrian', 'Kecerdasan Buatan Generatif', 'Analisis Rangkaian Sosial', 'Pengoptimuman Enjin Carian',
  'Biologi Marin Dalam', 'Geologi Plat Tektonik', 'Psikologi Kognitif Manusia', 'Sistem Terbenam Pintar'
];

let added = 0;
for (let i = 1010; i <= 4000; i++) {
  const cat = categories[i % categories.length];
  const topic = topics[i % topics.length];
  const title = `Ensiklopedia & Analisis Lanjutan #${i}: ${topic} dalam Perspektif Moden`;
  const slug = `ensiklopedia-analisis-${i}-${topic.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  const filename = `${slug}.md`;
  const filePath = path.join(dir, filename);

  if (fs.existsSync(filePath)) continue;

  const content = `SLUG: ${slug}
TITLE: ${title}
EXCERPT: Kajian kes dan analisis terperinci mengenai ${topic}, merangkumi latar belakang sejarah, implikasi teknikal, dan panduan praktikal untuk penyelidik serta profesional.
TAGS: ${cat.tags}

## Pengenalan Komprehensif

Dalam landskap global yang sentiasa berkembang, topik mengenai **${topic}** memegang peranan penting dalam membentuk arah tuju penyelidikan dan aplikasi industri moden. Artikel ini membincangkan secara mendalam teori asas, evolusi, serta implikasi praktikal bidang ini.

## Latar Belakang dan Sejarah Perkembangan

Perkembangan ${topic} bermula sejak beberapa dekad lalu melalui sumbangan para penyelidik perintis. Transformasi daripada konsep teoretikal kepada pelaksanaan berskala besar telah mengubah cara kita memahami dan menyelesaikan masalah kompleks dalam domain ini.

Antara tonggak utama dalam sejarah perkembangannya termasuklah:
1. **Fasa Teori Awal**: Pengenalan model matematik dan kerangka kerja asas.
2. **Evolusi Teknologi**: Peralihan kepada sistem digital dan automasi penuh.
3. **Penerapan Global**: Integrasi merentas pelbagai sektor industri utama.

## Analisis Teknikal dan Metodologi

Pendekatan moden dalam menangani cabaran berkaitan ${topic} memerlukan kefahaman kukuh terhadap metodologi berikut:

- **Pemodelan Sistem**: Menggunakan simulasi berasaskan data untuk meramal tingkah laku sistem.
- **Pengoptimuman Sumber**: Memastikan kecekapan tenaga dan masa pemprosesan yang optimum.
- **Pengurusan Risiko**: Mengenal pasti titik kegagalan (*single point of failure*) dan membina pelan mitigasi yang kukuh.

## Cabaran Semasa dan Hala Tuju Masa Depan

Walaupun banyak kemajuan telah dicapai, beberapa cabaran utama masih wujud, termasuk isu skalabiliti, keselamatan data, dan integrasi merentas platform legasi. Penyelidikan masa depan dijangka memberi fokus kepada penyelesaian autonomi dan kebolehoperasian yang lebih tinggi.

## Kesimpulan

Pemahaman yang mendalam tentang ${topic} bukan sahaja memperkaya khazanah ilmu pengetahuan, malah menjadi pemangkin kepada inovasi berterusan yang memberi manfaat kepada masyarakat global.
`;

  fs.writeFileSync(filePath, content, 'utf8');
  added++;
}
console.log('Successfully generated bulk encyclopedia articles:', added);
