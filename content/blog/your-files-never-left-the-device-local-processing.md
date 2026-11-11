SLUG: your-files-never-left-the-device-local-processing
TITLE: Your Files Never Left the Device — The Quiet Case for Local, In-Browser Tools
EXCERPT: A background remover, a converter, an image resizer: some do it by uploading your file to a server, some do it entirely in your browser. The difference is private and it is not a small one. Here is why "in-browser" beats "upload it".
TAGS: privacy, local-processing, browser, tools, webassembly, security

## Two kinds of "free online tool"

Type a task like "remove image background" or "convert HEIC to JPG" and you get dozens of sites. They look identical: a big drop zone, a button, a download. But underneath they split into two camps.

**The upload camp** ships your file across the internet to someone else's computer, processes it there, and sends the result back. It works, and for a huge batch it can even be faster. The cost is invisible: your photo — maybe your face, your receipt, your kid's picture, a document — is now sitting on a server you will never audit, in a country you did not choose, under a privacy policy you did not read.

**The local camp** runs the actual work inside *your* browser, using WebAssembly, the canvas, or the newer WebCodecs API. The file is read into memory, transformed, and re-saved without ever making a network request. There is no upload progress bar because there is nothing being uploaded.

## Why local is genuinely more private

Privacy here is not about promises in a legal page — it is about physics. A tool that never opens a socket to send your bytes cannot leak them. It cannot be subpoenaed for data it never held. It keeps working if the company behind it changes policy, gets hacked, or disappears, because the code already ran on your machine and your file never depended on their storage. When the network is slow, a local tool is often *faster* too, since it skips the round-trip of pushing megabytes up and pulling them back down.

The trade-off is honest: the browser has less raw power than a rack of servers, so a very heavy 4K job or a 200-file batch may run slower on an old phone, and a clever AI model that only exists server-side cannot run purely locally (unless it is small enough to download once, then work offline).

## How to tell which one you are looking at

Before you drop in anything sensitive:

- Open the browser's **Network** tab, run the tool once, and watch. If you see a large **upload** request to another domain right after you pick a file, it is server-side. If the transfer tab stays quiet, it is local.
- Read for the words **"processed in your browser"**, "runs on your device", or "no upload" — reputable local tools say so loudly because it is their selling point.
- Assume anything with an account, a "history" dashboard, or a "re-download later" link has kept a copy somewhere.

## The Tukuk stance

Every mini tool on the [app hub](https://tukuk.org/) is built to do its work client-side where it can be — an image on your screen does not need to tour a data center to have its background dropped or its format swapped. That is the same principle behind the rest of the site: no account, no tracking cookie, and, for your files, no trip through the network at all. The tools live at [tukuk.org](https://tukuk.org); the free web search that respects the same idea lives right on the homepage.
