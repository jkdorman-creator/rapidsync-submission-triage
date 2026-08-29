# Vendored dependency

`pdf.min.mjs` and `pdf.worker.min.mjs` are the generic browser build of
[PDF.js](https://mozilla.github.io/pdf.js/) v5.7.284, Apache-2.0, copied from
the `pdfjs-dist` npm package. Full license text in `pdfjs-LICENSE.txt`.

They are vendored rather than loaded from a CDN so the demo keeps working
without a third-party network dependency at judging time.
