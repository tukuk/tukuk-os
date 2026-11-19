# tukuk-pages

Tukuk-OS Pages — GitHub Pages site for tukuk.org (blog & articles).

## Folder Structure

```
tukuk-pages/
├── .github/workflows/ci.yml   # GitHub Actions CI
├── .gitignore                 # Git ignore rules
├── package.json               # Node.js manifest
├── README.md                  # This file
├── index.html                 # Homepage
├── blog/                      # Blog articles
├── articles/                  # Articles
└── _config.yml                # Jekyll config (optional)
```

## CI/CD

Push atau pull request akan menjalankan workflow CI di GitHub Actions.

GitHub Pages akan di-deploy secara automatik dari branch `gh-pages` atau `/docs` folder.

## License

ISC