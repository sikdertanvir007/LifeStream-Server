const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { MongoClient, ServerApiVersion } = require('mongodb');
const { ObjectId } = require('mongodb');
dotenv.config();
const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.c0uxcug.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    await client.connect();

    const db = client.db("lifeStreamDB");
    const donationRequestsCollection = db.collection("donationRequests");

    // ✅ GET all donation requests
    app.get("/donation-requests", async (req, res) => {
      const result = await donationRequestsCollection.find().toArray();
      res.send(result);
    });

app.get("/donation-requests/:id", async (req, res) => {
  const id = req.params.id;

  try {
    const result = await donationRequestsCollection.findOne({ _id: new ObjectId(id) });

    if (!result) {
      return res.status(404).send({ message: "Donation request not found" });
    }

    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Invalid ID or server error", error: error.message });
  }
});



    // ✅ POST a new donation request
    app.post("/donation-requests", async (req, res) => {
      const donationRequest = req.body;
      const result = await donationRequestsCollection.insertOne(donationRequest);
      res.send(result);
    });

    // ✅ GET donation requests made by a specific user (with optional status filter & pagination)
    app.get("/my-donation-requests", async (req, res) => {
      try {
        const { email, status, page = 1, limit = 5 } = req.query;

        if (!email) {
          return res.status(400).json({ error: "Email is required" });
        }

        const query = { requesterEmail: email };
        if (status) query.status = status;

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const total = await donationRequestsCollection.countDocuments(query);

        const requests = await donationRequestsCollection
          .find(query)
          .sort({ donationDate: -1 }) // latest first
          .skip(skip)
          .limit(parseInt(limit))
          .toArray();

        res.send({
          data: requests,
          total,
          page: parseInt(page),
          totalPages: Math.ceil(total / parseInt(limit)),
        });
      } catch (err) {
        console.error("Error fetching my donation requests:", err);
        res.status(500).json({ error: "Internal Server Error" });
      }
    });


    // Update status PATCH
app.patch("/donation-requests/:id", async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const { ObjectId } = require("mongodb");

  if (!ObjectId.isValid(id)) return res.status(400).send({ error: "Invalid ID" });

  const result = await donationRequestsCollection.updateOne(
    { _id: new ObjectId(id) },
    { $set: { status } }
  );
  res.send(result);
});

// Delete DELETE
app.delete("/donation-requests/:id", async (req, res) => {
  const { id } = req.params;
  const { ObjectId } = require("mongodb");

  if (!ObjectId.isValid(id)) return res.status(400).send({ error: "Invalid ID" });

  const result = await donationRequestsCollection.deleteOne({ _id: new ObjectId(id) });
  res.send(result);
});

    // ✅ Confirm MongoDB connection
    await client.db("admin").command({ ping: 1 });
    console.log("✅ Successfully connected to MongoDB!");
  } finally {
    // Don't close the connection so it remains active while server runs
    // await client.close();
  }
}
run().catch(console.dir);

// Sample route
app.get('/', (req, res) => {
  res.send('🩸 Lifestream server is running');
});

// Start the server
app.listen(port, () => {
  console.log(`🚀 Server is listening on port ${port}`);
});
