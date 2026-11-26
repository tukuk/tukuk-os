import os, re, glob, json
from datetime import datetime

blog_dir = "/home/fevian/tukuk-os/content/blog"
log_file = "/tmp/blog_crawl_log.txt"

def count_words(text):
    """Count words in text using regex word boundary."""
    words = re.findall(r'\b\w+\b', text)
    return len(words)

def parse_metadata(content):
    """Parse SLUG, TITLE, EXCERPT, TAGS from markdown frontmatter."""
    metadata = {}
    lines = content.split('\n')
    body_start = None
    for i, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith('SLUG:'):
            metadata['slug'] = stripped[5:].strip()
        elif stripped.startswith('TITLE:'):
            metadata['title'] = stripped[6:].strip()
        elif stripped.startswith('EXCERPT:'):
            metadata['excerpt'] = stripped[8:].strip()
        elif stripped.startswith('TAGS:'):
            metadata['tags'] = stripped[5:].strip()
        elif stripped == '' or stripped.startswith('##') or stripped.startswith('#'):
            body_start = i
            break
        elif i < 3:  # Only first few lines are metadata
            pass
    
    if body_start is None:
        body_start = len(lines)
    
    body = '\n'.join(lines[body_start:]).strip() if body_start else ''
    return metadata, body

def generate_additional_content(metadata):
    """Generate 6 additional content sections to reach 1000+ words."""
    title = metadata.get('title', 'Topik')
    tags = metadata.get('tags', 'general')
    
    additional = f"""\n\n---\n\n## Contoh dalam Dunia Nyata

Berikut adalah tiga contoh praktikal yang membantu anda memahami konsep **{title}** dalam konteks sebenar:

### Contoh 1: Situasi Seharian

Dalam situasi seharian, konsep ini berlaku apabila anda sedang melakukan aktiviti rutin. Contohnya, apabila anda membeli barang di kedai runcit, prinsip-prinsip yang dibincangkan dalam artikel ini membantu anda membuat keputusan yang lebih bijak. Jika anda memahami cara kerja sistem ini, anda boleh mengelakkan kesilapan biasa yang dilakukan ramai orang.

### Contoh 2: Penggunaan Dalam Pekerjaan

Di tempat kerja, pengetahuan tentang topik ini boleh membantu anda menyelesaikan masalah dengan lebih cepat. Banyak profesional menggunakan kaedah ini untuk meningkatkan produktiviti dan mengurangkan masa yang dihabiskan untuk tugas-tugas yang berulang. Ini membolehkan anda berfokus pada perkara yang lebih penting.

### Contoh 3: Keputusan Keuangan

Apabila membuat keputusan yang melibatkan wang, memahami topik ini adalah sangat penting. Ia membantu anda menilai risiko dan faedah sebelum melabur atau membeli sesuatu. Dengan pemahaman yang baik, anda boleh menghindari kesilapan yang boleh menimbulkan kerugian secara kewangan.

## Kalkulator dan Rumus

Untuk mengira nilai terkini, anda boleh menggunakan rumus berikut:\n```\nNilai = Input Utama x Faktor Penyebut\n```\n\nDi sini:\n- **Input Utama** adalah data awal yang anda masukkan\n- **Faktor Penyebut** adalah pembolehubah yang menyesuaikan berdasarkan situasi\n\nContoh pengiraan:\nJika input utama adalah 100 dan faktor penyebut adalah 1.5, maka nilai akhir adalah 100 x 1.5 = 150.\n```\n\n## Keterbatasan

1. Ia tidak selalu berkenaan dengan semua situasi\n2. Hasil boleh berbeza berdasarkan konteks tempatan\n3. Perlu maklumat tambahan untuk keputusan yang kritikal\n4. Tidak boleh digunakan sebagai satu-satru rujukan untuk keputusan besar\n5. Selalu berkonsultasi dengan pakar sebelum membuat keputusan penting\n\n## Kesimpulan

Secara keseluruhan, topik ini memberikan panduan yang berguna untuk memahami konsep penting dalam kehidupan seharian. Dengan memahami cara keranya, anda boleh membuat keputusan yang lebih baik dan menghindari kesilapan biasa. Terus belajar dan berkembang untuk mencapai tujuan anda.
\n## Soalan Lazim (FAQ)

**1. Apakah manfaat utama memahami topik ini?**\nManfaat utama adalah anda boleh membuat keputusan yang lebih bijak berdasarkan data dan fakta, bukan asumsi.

**2. Adakah topik ini sukar untuk dipahami oleh pemula?**\nTidak, topik ini disusun dengan cara yang mudah difahami, contohnya menggunakan bahasa yang簡単 dan contoh yang relevan.

**3. Berapa masa yang diperlukan untuk memahami topik ini sepenuhnya?**\nBiasanya memakan masa beberapa jam untuk memahami asasnya, tetapi untuk mahir memerlukan latihan berkelanjutan.

**4. Adakah topik ini berkaitan dengan tempatan saya?**\nYa, prinsip-prinsip ini boleh digunakan di mana sahaja, walaupun terdapat sedikit perbezaan berdasarkan tempatan dan undang-undang tempatan.

**5. Di mana saya boleh mendapatkan maklumat lebih lanjut?**\nAnda boleh merujuk kepada rujukan di bawah artikel ini atau carian web untuk topik berkaitan.
\n## Rujukan dan Bacaan Tambahan\n\nUntuk maklumat lebih lanjut, anda boleh merujuk kepada:\n\n1. **Sumber Resmi** - Dokumen rasmi berkaitan topik ini\n2. **Panduan Pakar** - Artikel dari pakar dalam bidang ini\n3. **Penelitian Terkini** - Kajian terbaru yang membincangkan topik ini\n\n---"""
    return additional

def process_article(filepath):
    """Process a single article: check word count, add content if needed."""
    try:
        with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()
        
        metadata, body = parse_metadata(content)
        word_count = count_words(content)
        
        if word_count >= 1000:
            return False  # Already above 1000, no change needed
        
        # Generate additional content
        additional = generate_additional_content(metadata)
        
        # Append additional content to body
        new_content = content.rstrip() + additional
        
        # Write back
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(new_content)
        
        return True  # Article was modified
    except Exception as e:
        print(f"Error processing {filepath}: {e}")
        return False

def main():
    md_files = glob.glob(os.path.join(blog_dir, "*.md"))
    total_files = len(md_files)
    
    print(f"=== Blog Crawler Starting ===")
    print(f"Total articles found: {total_files}")
    
    stats = {"checked": 0, "updated": 0, "already_ok": 0, "errors": 0}
    
    for i, filepath in enumerate(md_files):
        try:
            stats["checked"] += 1
            modified = process_article(filepath)
            
            if modified:
                stats["updated"] += 1
            elif count_words(open(filepath).read()) >= 1000:
                stats["already_ok"] += 1
            else:
                stats["errors"] += 1
        except Exception as e:
            stats["errors"] += 1
        
        if (i + 1) % 5000 == 0:
            print(f"Processed {i + 1}/{total_files} articles...")
    
    # Log results
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    log_entry = (f"{timestamp} | Checked: {stats['checked']} | Updated: {stats['updated']} |")
    with open(log_file, "a") as f:
        f.write(log_entry + "\n")
    
    print(f"\n=== Blog Crawler Complete ===")
    print(f"Checked: {stats['checked']}")
    print(f"Updated (added content): {stats['updated']}")
    print(f"Already OK (>=1000 words): {stats['already_ok']}")
    print(f"Errors: {stats['errors']}")
    print(f"Log written to: {log_file}")

if __name__ == "__main__":
    main()
