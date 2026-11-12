const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', 'content', 'blog');

const categories = [
  { name: 'Sains & Alam', tags: 'sains, alam, alam-semulajadi, fizik' },
  { name: 'Teknologi & Web', tags: 'teknologi, web, pembangunan, perisian' },
  { name: 'Kesihatan & Gaya Hidup', tags: 'kesihatan, gaya-hidup, kesejahteraan, minda' },
  { name: 'Kewangan & Produktiviti', tags: 'kewangan, produktiviti, pengurusan, kerjaya' },
  { name: 'Keselamatan & Privasi', tags: 'keselamatan, privasi, siber, data' }
];

const topics = [
  'Inovasi Digital', 'Kesan Perubahan Iklim', 'Sistem Teragih', 'Kecerdasan Buatan', 'Optimasi Prestasi',
  'Algoritma Carian', 'Pengurusan Masa', 'Analisis Data', 'Infrastruktur Awan', 'Rangkaian Tanpa Wayar',
  'Pembiayaan Mampan', 'Pembangunan Aplikasi', 'Seni Bina Perisian', 'Kesihatan Mental', 'Strategi Belajar',
  'Kriptografi Moden', 'Sistem Operasi', 'Pengaturcaraan Bersiri', 'Automasi Tugas', 'Pengujian Perisian'
];

let added = 0;
for (let i = 1; i <= 800; i++) {
  const cat = categories[i % categories.length];
  const topic = topics[i % topics.length];
  const title = `Panduan Komprehensif #${i}: ${topic} dan Kesannya Terhadap Industri Moden`;
  const slug = `panduan-komprehensif-${i}-${topic.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  const filename = `${slug}.md`;
  const filePath = path.join(dir, filename);

  if (fs.existsSync(filePath)) continue;

  const content = `SLUG: ${slug}
TITLE: ${title}
EXCERPT: Analisis terperinci mengenai ${topic} dalam landskap moden, merangkumi amalan terbaik, strategi pelaksanaan, dan panduan praktikal untuk profesional.
TAGS: ${cat.tags}

## Pengenalan Kepada ${topic}

Dalam era digital yang pantas berkembang hari ini, pemahaman mendalam tentang **${topic}** menjadi satu keperluan asas bagi setiap profesional dan pengamal industri. Artikel ini mengupas secara mendalam prinsip asas, cabaran semasa, serta hala tuju masa depan teknologi dan metodologi ini.

## Prinsip Teras dan Pelaksanaan

Pelaksanaan yang berjaya memerlukan perancangan teliti dan pematuhan kepada piawaian industri yang diiktiraf. Antara aspek penting yang perlu diberi perhatian termasuklah:

1. **Analisis Keperluan Awal**: Mengenal pasti skop dan matlamat jangka panjang.
2. **Pengoptimuman Sumber**: Memastikan kecekapan operasi tanpa kompromi terhadap kualiti.
3. **Penyeliaan Berterusan**: Memantau prestasi secara real-time untuk mengesan sebarang kelemahan lebih awal.

## Cabaran dan Penyelesaian

Setiap inovasi pasti berdepan dengan cabaran tersendiri. Isu keselamatan, skalabiliti, dan kebolehsuaian sistem sering menjadi halangan utama. Melalui pendekatan yang sistematik, pengamal dapat mengurangkan risiko kegagalan dan meningkatkan daya tahan sistem secara keseluruhan.

## Kesimpulan

Secara keseluruhannya, penglibatan aktif dalam memahami ${topic} akan membuka lebih banyak peluang pembangunan dan inovasi yang mampan untuk masa depan. Amalan terbaik yang dikongsikan di sini adalah asas rujukan penting bagi membina ekosistem yang lebih kukuh.
`;

  fs.writeFileSync(filePath, content, 'utf8');
  added++;
}
console.log('Successfully generated new blog articles:', added);
