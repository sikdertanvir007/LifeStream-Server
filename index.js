const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { MongoClient, ServerApiVersion } = require('mongodb');
const admin = require("firebase-admin");
const { ObjectId } = require("mongodb");

dotenv.config();

const stripe = require('stripe')(process.env.PAYMENT_GATEWAY_KEY); // Replace with your actual Stripe secret key

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());



const decodedKey = Buffer.from(process.env.FB_SERVICE_KEY,'base64').toString('utf8')
const serviceAccount = JSON.parse(decodedKey);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});



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
   // await client.connect();

    const db = client.db("lifeStreamDB");
    const donationRequestsCollection = db.collection("donationRequests");
    const fundingsCollection = db.collection("fundings");
    const usersCollection = db.collection('users');
    const blogsCollection = db.collection('blogs')


//custom middlewares
const verifyFBToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).send({ message: 'unauthorized access' });
  }

  const token = authHeader.split(' ')[1]; 
  if (!token) {
    return res.status(401).send({ message: 'unauthorized access' });
  }

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.decoded = decoded;
    next();
  } catch (error) {
    return res.status(403).send({ message: 'forbidden access' });
  }
};


const verifyAdmin = async (req,res,next)=> {
  const email = req.decoded.email;
  const query = {email}
  const user = await usersCollection.findOne(query);
  if(!user || user.role !== 'admin'){
    return res.status(403).send({message: 'forbidden access'})
  }
  next();
}


// GET route to fetch role by email
app.get('/users/role/:email', verifyFBToken, async (req, res) => {
  const email = req.params.email;
  const decodedEmail = req.decoded.email;

  if (decodedEmail !== email) {
    return res.status(403).send({ message: 'forbidden access' });
  }

  try {
    const user = await usersCollection.findOne({ email });

    if (!user) {
      return res.status(404).json({ role: null });
    }

    res.status(200).json({ role: user.role }); // 'admin', 'volunteer', or 'donor'
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
});



app.post('/users',async(req,res)=>{
    const email = req.body.email;
    const userExists = await usersCollection.findOne({email})
    if(userExists){
        return res.status(200).send({message: 'User already exists', inserted:false});
    } 
    const user = req.body;
    const result = await usersCollection.insertOne(user);
    res.send(result);
})




    // ✅ GET all donation requests
    app.get("/donation-requests", async (req, res) => {
      const result = await donationRequestsCollection.find().toArray();
      res.send(result);
    });





    // ✅ POST a new donation request
    app.post("/donation-requests", async (req, res) => {
      const donationRequest = req.body;
      const result = await donationRequestsCollection.insertOne(donationRequest);
      res.send(result);
    });

    // ✅ GET donation requests made by a specific user (with optional status filter & pagination)
    app.get("/my-donation-requests",verifyFBToken, async (req, res) => {
      try {
        const { email, status, page = 1, limit = 5 } = req.query;
        console.log('decoded',req.decoded)
        if(req.decoded.email !== email){
            return res.status(403).send({message:"forbidden access"})
        }

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


// GET: /user-fundings?email=user@example.com&page=1&limit=10
app.get('/user-fundings', verifyFBToken, async (req, res) => {
  const { email, page = 1, limit = 10 } = req.query;
   console.log('decoded',req.decoded)
        if(req.decoded.email !== email){
            return res.status(403).send({message:"forbidden access"})
        }
  
  const skip = (parseInt(page) - 1) * parseInt(limit);

  const query = { email };
  const total = await fundingsCollection.countDocuments(query);
  const fundings = await fundingsCollection.find(query)
    .sort({ date: -1 })
    .skip(skip)
    .limit(parseInt(limit))
    .toArray();

  res.send({ fundings, total });
});


app.post('/fundings', async (req, res) => {
  const funding = req.body; // contains name, email, amount, date
  const result = await fundingsCollection.insertOne(funding);
  res.send(result);
});

app.post('/create-payment', async (req, res) => {
  const { amount } = req.body;
  const paymentIntent = await stripe.paymentIntents.create({
    amount: parseInt(amount * 100), // Stripe works in cents
    currency: 'usd',
    payment_method_types: ['card'],
  });

  res.send({ clientSecret: paymentIntent.client_secret });
});

// GET all users with pagination and filtering by status (active or blocked)
app.get('/users', verifyFBToken,verifyAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const query = {};
    if (status) query.status = status;  // filter by status

    const total = await usersCollection.countDocuments(query);
    const users = await usersCollection
      .find(query)
      .skip(skip)
      .limit(parseInt(limit))
      .toArray();

    res.send({
      users,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit))
    });
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: 'Internal Server Error' });
  }
});


// PATCH to update user's status or role (block/unblock/make-volunteer/make-admin)
app.patch('/users/:id', verifyFBToken, async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;  // { status: 'blocked' } or { role: 'admin' }

    if (!ObjectId.isValid(id)) return res.status(400).send({ message: 'Invalid user id' });

    const result = await usersCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateData }
    );
    res.send(result);
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: 'Internal Server Error' });
  }
});


//Profile related api's

app.get('/api/users', async (req, res) => {
  const { email } = req.query;
  const user = await usersCollection.findOne({ email });
  res.send(user);
});

app.put('/api/users/:email', async (req, res) => {
  const { email } = req.params;
  const updatedData = req.body;
  const result = await usersCollection.updateOne(
    { email },
    { $set: updatedData }
  );
  res.send(result);
});


// GET all donation requests (admin only, with pagination + status filter)
app.get("/admin-donation-requests", verifyFBToken, async (req, res) => {
  try {
    const { page = 1, limit = 5, status } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const query = {};
    if (status) query.status = status;

    const total = await donationRequestsCollection.countDocuments(query);
    const requests = await donationRequestsCollection
      .find(query)
      .sort({ donationDate: -1 })
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
    console.error("Error fetching admin donation requests:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// ✅ Public Donor Search
app.get('/public-donors', async (req, res) => {
  try {
    const { bloodGroup, district, upazila } = req.query;
    const query = {
      role: 'donor',
      status: 'active'
    };

    if (bloodGroup) query.bloodGroup = bloodGroup;
    if (district) query.district = district;
    if (upazila) query.upazila = upazila;

    const donors = await usersCollection.find(query).toArray();
    res.send(donors);
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: 'Server Error' });
  }
});


// Public route: list all pending donation requests
app.get('/public-donation-requests', async (req, res) => {
  try {
    const pendingRequests = await donationRequestsCollection
      .find({ status: 'pending' })
      .sort({ donationDate: -1 })
      .toArray();
    res.send(pendingRequests);
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: 'Server error' });
  }
});

// Protected detail route
app.get('/donation-requests/:id', verifyFBToken, async (req, res) => {
  const { id } = req.params;
  if (!ObjectId.isValid(id)) return res.status(400).send({ message: 'Invalid ID' });
  try {
    const request = await donationRequestsCollection.findOne({ _id: new ObjectId(id) });
    if (!request) return res.status(404).send({ message: 'Request not found' });
    res.send(request);
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: 'Server error' });
  }
});

// Confirm donation by donor (status: pending → inprogress)
app.patch('/donation-requests/donate/:id', verifyFBToken, async (req, res) => {
  const { id } = req.params;
  const { donorName, donorEmail } = req.body;

  if (!ObjectId.isValid(id)) return res.status(400).send({ message: 'Invalid ID' });

  try {
    const result = await donationRequestsCollection.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          status: 'inprogress',
          donorName,
          donorEmail
        }
      }
    );

    if (result.modifiedCount === 0) {
      return res.status(404).send({ message: 'Donation request not found or already in progress' });
    }

    res.send({ message: 'Donation confirmed successfully', result });
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: 'Server error' });
  }
});



// ✅ GET: Count total donors
app.get('/users/count-donors', verifyFBToken,  async (req, res) => {
  try {
    const count = await usersCollection.countDocuments({ role: 'donor' });
    res.json({ count });
  } catch (error) {
    res.status(500).json({ message: 'Failed to count donors', error: error.message });
  }
});

// ✅ GET: Total funding amount
app.get('/fundings/total-amount', verifyFBToken,  async (req, res) => {
  try {
    const result = await fundingsCollection.aggregate([
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]).toArray();

    const totalAmount = result[0]?.total || 0;
    res.json({ totalAmount });
  } catch (error) {
    res.status(500).json({ message: 'Failed to get total funding amount', error: error.message });
  }
});

// ✅ GET: Total number of donation requests
app.get('/donation-requests/count', verifyFBToken,  async (req, res) => {
  try {
    const count = await donationRequestsCollection.countDocuments();
    res.json({ count });
  } catch (error) {
    res.status(500).json({ message: 'Failed to count donation requests', error: error.message });
  }
});


app.get('/users/status', verifyFBToken, async (req, res) => {
  const email = req.query.email;
  const user = await usersCollection.findOne({ email });

  if (!user) {
    return res.status(404).json({ message: 'User not found' });
  }

  res.send({ status: user.status || 'active' });
});



app.post('/blogs', verifyFBToken, async (req, res) => {
  const blog = {
    ...req.body,
    status: 'draft',
    createdAt: new Date(),
    author: {
      name: req.decoded.name,
      email: req.decoded.email
    }
  };
  const result = await blogsCollection.insertOne(blog);
  res.send(result);
});


app.get('/blogs', async (req, res) => {
  const status = req.query.status;
  const filter = status ? { status } : {};
  const blogs = await blogsCollection.find(filter).sort({ createdAt: -1 }).toArray();
  res.send(blogs);
});

app.get('/blogs/:id', async (req, res) => {
  const blog = await blogsCollection.findOne({ _id: new ObjectId(req.params.id) });
  res.send(blog);
});


// Example in Express backend
app.patch('/blogs/:id/status', verifyFBToken, async (req, res) => {
  try {
    const blogId = req.params.id;
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({ message: 'Status is required' });
    }

    const result = await blogsCollection.updateOne(
      { _id: new ObjectId(blogId) },
      { $set: { status } }
    );

    if (result.modifiedCount === 0) {
      return res.status(404).json({ message: 'Blog not found or already has this status' });
    }

    res.send({ message: 'Blog status updated successfully' });
  } catch (err) {
    console.error('PATCH /blogs/:id/status error:', err); // This should show in terminal
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});



app.patch('/blogs/:id', verifyFBToken, async (req, res) => {
  const { title, thumbnail, content } = req.body;
  const result = await blogsCollection.updateOne(
    { _id: new ObjectId(req.params.id), 'author.email': req.decoded.email },
    { $set: { title, thumbnail, content } }
  );
  res.send(result);
});



// Define inside run()
const getUserByEmail = async (email) => {
  return await usersCollection.findOne({ email });
};

// Delete route
app.delete('/blogs/:id', verifyFBToken, async (req, res) => {
  try {
    const user = await getUserByEmail(req.decoded.email);
    if (!user || user.role !== 'admin') {
      return res.status(403).send({ message: 'Forbidden' });
    }

    const result = await blogsCollection.deleteOne({ _id: new ObjectId(req.params.id) });
    if (result.deletedCount === 0) {
      return res.status(404).send({ message: 'Blog not found' });
    }

    res.send({ message: 'Blog deleted successfully' });
  } catch (error) {
    console.error('DELETE error:', error);
    res.status(500).send({ message: 'Server error', error: error.message });
  }
});




    // ✅ Confirm MongoDB connection
    //await client.db("admin").command({ ping: 1 });
   // console.log("✅ Successfully connected to MongoDB!");
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
