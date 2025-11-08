require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const mongoose = require("mongoose");
const Tesseract = require("tesseract.js");
const OpenAI = require("openai");
const cosine = require("cosine-similarity");

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: "25mb" }));
app.use(bodyParser.urlencoded({ extended: true, limit: "25mb" }));

// ✅ MongoDB Connection
mongoose
  .connect("mongodb://127.0.0.1:27017/synapseDB")
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => console.error("❌ MongoDB Connection Error:", err));

// ✅ Schema (Date fixed for filtering)
const NoteSchema = new mongoose.Schema({
  text: String,
  embedding: [Number],
  tags: [String],
  image: String,
  createdAt: { type: Date, default: Date.now },
});
const Note = mongoose.model("Note", NoteSchema);

// ✅ OpenAI Setup
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ✅ Generate Text Embeddings
async function generateEmbedding(text) {
  if (!text || text.trim() === "") throw new Error("Empty text provided.");

  try {
    const response = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: text,
    });
    return response.data[0].embedding;
  } catch (err) {
    console.warn("⚠️ OpenAI embedding API failed, using dummy fallback.");
    return Array(1536).fill(Math.random()); // fallback if API quota exceeded
  }
}

// ✅ Auto Tagging
function autoTag(text) {
  const tags = [];
  const lower = text.toLowerCase();
  const colors = [
    "black", "white", "red", "blue", "green", "yellow",
    "grey", "gray", "brown", "purple", "orange", "pink"
  ];
  const objects = [
    "shoe", "bag", "shirt", "laptop", "phone", "book",
    "dress", "watch", "bottle", "pen", "car", "bike"
  ];
  colors.forEach((c) => lower.includes(c) && tags.push(c));
  objects.forEach((o) => lower.includes(o) && tags.push(o));
  return [...new Set(tags)];
}

// ✅ Save Text Note
app.post("/api/save", async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || !text.trim()) return res.status(400).send("Cannot save empty note.");

    const tags = autoTag(text);
    const embedding = await generateEmbedding(text);

    const newNote = new Note({
      text,
      embedding,
      tags,
      createdAt: new Date(),
    });

    await newNote.save();
    console.log("💾 Note saved:", text.slice(0, 60), "| Tags:", tags);
    res.status(200).send("Saved successfully ✅");
  } catch (err) {
    console.error("❌ Save error:", err.message);
    res.status(500).send("Server error while saving note.");
  }
});

// ✅ Keyword Search
app.get("/api/search", async (req, res) => {
  try {
    const q = req.query.q || "";
    const results = await Note.find({
      $or: [
        { text: { $regex: q, $options: "i" } },
        { tags: { $regex: q, $options: "i" } },
      ],
    });
    res.json(results);
  } catch (err) {
    console.error("❌ Keyword search error:", err.message);
    res.status(500).send("Search error");
  }
});

// ✅ Smart (Semantic) Search
app.get("/api/semantic-search", async (req, res) => {
  try {
    const q = req.query.q || "";
    if (!q.trim()) return res.status(400).send("Empty search query.");

    console.log(`🔍 Performing semantic search for: "${q}"`);
    const queryEmbedding = await generateEmbedding(q);
    const notes = await Note.find();

    const results = notes
      .map((note) => ({
        text: note.text,
        tags: note.tags,
        image: note.image,
        score: cosine(note.embedding, queryEmbedding),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    res.json(results);
  } catch (err) {
    console.error("❌ Smart search error:", err.message);
    res.status(500).send("Smart search error");
  }
});

// ✅ OCR Image Upload + Auto Tag + Save
app.post("/api/upload-image", async (req, res) => {
  try {
    const { imageBase64 } = req.body;
    if (!imageBase64) return res.status(400).send("No image provided");

    console.log("🖼️ Processing image...");
    const result = await Tesseract.recognize(imageBase64, "eng");
    const extractedText = result.data.text || "";
    const tags = autoTag(extractedText);

    const newNote = new Note({
      text: extractedText || "Image content",
      tags,
      image: imageBase64,
      createdAt: new Date(),
    });
    await newNote.save();

    console.log("💾 Image + text saved | Tags:", tags);
    res.json({ message: "Image saved", text: extractedText, tags });
  } catch (err) {
    console.error("❌ OCR failed:", err.message);
    res.status(500).json({ error: "OCR Failed" });
  }
});

// ✅ Analytics Endpoint
app.get("/api/analytics", async (req, res) => {
  try {
    const notes = await Note.find();
    const totalNotes = notes.length;
    const thisMonth = new Date().getMonth();
    const thisMonthNotes = notes.filter(
      (n) => new Date(n.createdAt).getMonth() === thisMonth
    ).length;

    const tagCount = {};
    notes.forEach((n) =>
      n.tags.forEach((t) => (tagCount[t] = (tagCount[t] || 0) + 1))
    );
    const topTags = Object.keys(tagCount)
      .sort((a, b) => tagCount[b] - tagCount[a])
      .slice(0, 3);

    res.json({ totalNotes, thisMonthNotes, topTags });
  } catch (err) {
    console.error("❌ Analytics error:", err.message);
    res.status(500).send("Analytics error");
  }
});

// ✅ Filter by Date & Tag
app.get("/api/filter", async (req, res) => {
  try {
    const { start, end, tag } = req.query;
    const filter = {};

    const parseDate = (dateStr) => {
      if (!dateStr) return null;
      const [day, month, year] = dateStr.split("-");
      return new Date(`${year}-${month}-${day}`);
    };

    const startDate = parseDate(start);
    const endDate = parseDate(end);

    if (startDate && endDate) {
      endDate.setHours(23, 59, 59, 999);
      filter.createdAt = { $gte: startDate, $lte: endDate };
    }

    if (tag && tag.trim() !== "") {
      filter.$or = [
        { tags: { $regex: tag, $options: "i" } },
        { text: { $regex: tag, $options: "i" } },
      ];
    }

    console.log("📅 Applying filter:", filter);
    const notes = await Note.find(filter).sort({ createdAt: -1 });

    console.log(`✅ Found ${notes.length} matching notes`);
    res.json(notes);
  } catch (err) {
    console.error("❌ Filter error:", err.message);
    res.status(500).send("Filter error");
  }
});

// ✅ Start Server
app.listen(5000, () => {
  console.log("🚀 Backend running on http://localhost:5000");
});
