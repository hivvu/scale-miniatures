# The three fonts the front page uses

Served from here rather than from Google so the page works on a network with no way out, and so it asks
nothing of anybody else while somebody is reading it. Only the `latin` and `latin-ext` subsets are kept,
which is 14 files and about 196 KB in total.

| Family | Weights | Used for |
|---|---|---|
| [Anton](https://fonts.google.com/specimen/Anton) | 400 | the headings |
| [Barlow](https://fonts.google.com/specimen/Barlow) | 400, 500, 600, 700 | body text |
| [IBM Plex Mono](https://fonts.google.com/specimen/IBM+Plex+Mono) | 400, 700 | labels, keycaps and the status line |

All three are under the **SIL Open Font License 1.1**, whose text is in `OFL.txt` beside this file. Each
family has its own copyright holders: the Anton Project Authors, the Barlow Project Authors and IBM
Corporation respectively. The licence is the same for all three, so one copy of it covers them.

`../fonts.css` declares the faces and is what the page loads. To change the set, fetch the CSS from Google
Fonts with a modern browser's user agent, keep the `latin` and `latin-ext` blocks, download the `woff2`
files into this folder and rewrite the URLs to point here.
