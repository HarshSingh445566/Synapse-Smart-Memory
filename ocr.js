const Tesseract = require("tesseract.js");

async function extractTextFromImage(base64Image) {
  const result = await Tesseract.recognize(base64Image, "eng");
  return result.data.text;
}

module.exports = extractTextFromImage;
