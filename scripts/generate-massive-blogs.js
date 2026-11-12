const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', 'content', 'blog');

const categories = [
  { name: 'Sains & Teknologi Angkasa', tags: 'sains, angkasa, teknologi, astronomi' },
  { name: 'Seni Bina & Perbandaran Moden', tags: 'seni-bina, bandar, perbandaran, infrastruktur' },
  { name: 'Sejarah Tamadun & Arkeologi', tags: 'sejarah, tamadun, arkeologi, dunia' },
  { name: 'Sains Komputer & Sistem Teragih', tags: 'sains-komputer, sistem-teragih, pengaturcaraan, data' },
  { name: 'Ekonomi Global & Pasaran Kewangan', tags: 'ekonomi, pasaran, kewangan, perniagaan' },
  { name: 'Kesihatan Awam & Bioperubatan', tags: 'kesihatan, perubatan, biologi, kesejahteraan' },
  { name: 'Tenaga Lestari & Perubahan Iklim', tags: 'tenaga, lestari, iklim, alam-sekitar' }
];

const topics = [
  'Inovasi Pengkomputeran Kuantum', 'Dinamik Atmosfera Planet', 'Aritek Bandar Pintar Masa Depan',
  'Sejarah Perdagangan Maritim Purba', 'Sistem Pangkalan Data Teragih Berskala Besar', 'Kesan Gelombang Gravitasi',
  'Kecerdasan Buatan dalam Diagnostik Perubatan', 'Ekonomi Makro Pasca Moden', 'Teknologi Penangkapan Karbon',
  'Keselamatan Rantaian Bekalan Global', 'Evolusi Protokol Internet IPv6', 'Biologi Molekul dan Genomik',
  'Matematik Disebalik Kriptografi Kunci Moden', 'Fizik Zarah dan Pemecut Linear', 'Pengurusan Sumber Air Global',
  'Sistem Tenaga Solar Generasi Ketiga', 'Automasi Kilang Pintar Industri 4.0', 'Psikologi Tingkah Laku Pengguna Digital',
  'Sejarah Pengenalan Mata Wang Fiat', 'Seni Bina Mikroservis dan Bekas Kubernetes'
];

let added = 0;
for (let i = 4001; i <= 10000; i++) {
  const cat = categories[i % categories.length];
  const topic = topics[i % topics.length];
  const title = `Kajian Saintifik & Analisis Mendalam #${i}: ${topic} dan Masa Depan Industri`;
  const slug = `kajian-saintifik-${i}-${topic.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  const filename = `${slug}.md`;
  const filePath = path.join(dir, filename);

  if (fs.existsSync(filePath)) continue;

  const content = `SLUG: ${slug}
TITLE: ${title}
EXCERPT: Kajian ilmiah komprehensif mengenai ${topic}, merangkumi penemuan terkini, analisis teknikal, serta implikasi jangka panjang terhadap pembangunan global.
TAGS: ${cat.tags}

## Pengenalan dan Latar Belakang

Dalam era globalisasi dan transformasi digital yang pantas, bidang **${topic}** telah menjadi teras kepada pelbagai inovasi strategik. Perbincangan ini merangkumi sorotan literatur, kaedah penyelidikan, serta impak langsung terhadap ekosistem industri moden.

## Metodologi dan Pendekatan Analisis

Kajian ini menggunakan pendekatan empirikal dan pemodelan analitikal untuk menilai prestasi serta kebolehlaksanaan sistem berkaitan ${topic}. Antara komponen utama yang dinilai termasuklah:

1. **Parameter Prestasi Utama (KPI)**: Menilai kecekapan operasi dan masa tindak balas sistem.
2. **Skalabiliti dan Ketahanan**: Menguji keupayaan sistem menangani beban kerja tinggi (*high throughput workload*).
3. **Pematuhan Piawaian Keselamatan**: Memastikan integriti data dan perlindungan privasi pada tahap optimum.

## Implikasi dan Cabaran Industri

Walaupun potensi ${topic} amat besar, beberapa cabaran teknikal dan kawal selia masih perlu ditangani. Isu kos pelaksanaan awal, keperluan tenaga kerja mahir, serta keserasian dengan infrastruktur sedia ada sering menjadi halangan utama yang memerlukan strategi penyelesaian holistik.

## Hala Tuju Masa Depan

Penyelidikan masa depan dalam bidang ${topic} dijangka lebih menjurus kepada integrasi kecerdasan buatan, automasi penuh, dan penyelesaian yang merta (*real-time*). Kolaborasi antara sektor akademik dan industri akan terus menjadi pemacu utama kejayaan transformatif ini.

## Kesimpulan

Secara keseluruhan, pemahaman mendalam dan pelaburan strategik dalam ${topic} adalah langkah penting untuk memastikan daya saing jangka panjang dalam pasaran global yang kompetitif.
`;

  fs.writeFileSync(filePath, content, 'utf8');
  added++;
}
console.log('Successfully generated massive blog articles:', added);
