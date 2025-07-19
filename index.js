const express = require('express')
const cors=require('cors')
//const jwt = require("jsonwebtoken");
const cron = require('node-cron');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const app = express()
const port = 3000
require('dotenv').config()
app.use(cors())
app.use(express.json());


// 
//user:newspaper-fullstack-project
//pass:gMPg4edfeACNTTjt


const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.mos4qzt.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

console.log(process.env.DB_USER)

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
   //await client.connect();
     const db = client.db('newspaperDB'); // database name
        const articlesCollection = db.collection('articles');
        const usersCollection=db.collection('users')
        const publisherCollection=db.collection("publishers")
     


        
  // GET /publishers
app.get("/publishers", async (req, res) => {
  const publishers = await publisherCollection.find().toArray();
  res.send(publishers);
});


    app.post("/publishers", async (req, res) => {
  const publisher = req.body;
  const result = await publisherCollection .insertOne(publisher);
  res.send(result);
});

app.get("/articles", async (req, res) => {
  let query = {};

  if (req.query.email) {
    query.email = req.query.email; // or use `query.email = ...` based on your schema
  }

  const articles = await articlesCollection.find(query).toArray(); // ✅ always return array
  res.send(articles);
});

app.get("/article", async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;

  let query = {};
  if (req.query.email) {
    query.email = req.query.email;
  }

  const total = await articlesCollection.countDocuments(query);
  const data = await articlesCollection
    .find(query)
    .skip(skip)
    .limit(limit)
    .toArray();

  res.send({ total, data });
});


app.patch('/articles/approve/:id', async (req, res) => {
  try {
   
    const { id } = req.params;
    const result = await articlesCollection.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          status: 'approved',
          postedDate: new Date().toISOString(),
          declineReason: '',
        },
      }
    );
    res.send(result);
  } catch (err) {
    res.status(500).send({ error: 'Failed to approve article' });
  }
});
app.get('/tags', async (req, res) => {
  try {
    const tags = await articlesCollection.aggregate([
      { $match: { tags: { $exists: true, $ne: [] } } },
      { $unwind: "$tags" },
      { $group: { _id: "$tags" } },
      { $sort: { _id: 1 } }
    ]).toArray();

    const uniqueTags = tags.map(tag => tag._id);
    res.send(uniqueTags);
  } catch (err) {
    console.error("Error fetching tags:", err);
    res.status(500).send({ error: "Failed to fetch tags" });
  }
});

// ✅ Replaces both old '/articles/approve' and '/articles/approved'
app.get("/article/approve", async (req, res) => {
  try {
    const { title, publisher, tags } = req.query;
    const filter = { status: "approved" };

    if (title) {
      // Case-insensitive title search
      filter.title = { $regex: title, $options: "i" };
    }

    if (publisher) {
      filter.publisher = publisher;
    }

    if (tags) {
      const tagArray = tags.split(",");
      filter.tags = { $in: tagArray };
    }

    const articles = await articlesCollection
      .find(filter)
      .sort({ postedDate: -1 })
      .toArray();

    res.send(articles);
  } catch (err) {
    console.error("Error fetching filtered approved articles:", err);
    res.status(500).send({ error: "Failed to fetch approved articles" });
  }
});


app.patch('/articles/decline/:id', async (req, res) => {
  try {
 
    const { id } = req.params;
    const { reason } = req.body;

    if (!reason) {
      return res.status(400).json({ error: 'Reason is required' });
    }

    const result = await articlesCollection.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          status: 'declined',
          declineReason: reason,
        },
      }
    );
    res.send(result);
  } catch (err) {
    res.status(500).send({ error: 'Failed to decline article' });
  }
});

app.put("/article/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const updateData = req.body;

    const filter = { _id: new ObjectId(id) };
    const updateDoc = {
      $set: {
        title: updateData.title,
        image: updateData.image,
        description: updateData.description,
        publisher: updateData.publisher,
        tags: updateData.tags,
        status: "pending", // reset to pending on update
        updated_at: new Date(),
      },
    };

    const result = await articlesCollection.updateOne(filter, updateDoc);

    if (result.matchedCount === 0) {
      return res.status(404).send({ error: "Article not found" });
    }

    res.send({ message: "Article updated successfully", result });
  } catch (error) {
    console.error("Error updating article:", error);
    res.status(500).send({ error: "Failed to update article" });
  }
});

app.patch("/articles/:id", async (req, res) => {
  const articleId = req.params.id;
  const updatedData = req.body;

  try {
    const result = await articlesCollection.updateOne(
      { _id: new ObjectId(articleId) },
      {
        $set: {
          title: updatedData.title,
          description: updatedData.description,
          image: updatedData.image,
          tags: updatedData.tags,
          publisher: updatedData.publisher,
          publisherId: updatedData.publisherId,
          // You can add more fields here if needed
        },
      }
    );

    res.send(result);
  } catch (error) {
    console.error("Error updating article:", error);
    res.status(500).send({ message: "Failed to update article" });
  }
});
app.delete('/articles/:id', async (req, res) => {
  try {
    
    const { id } = req.params;
    const result = await articlesCollection.deleteOne({ _id: new ObjectId(id) });
    res.send(result);
  } catch (err) {
    res.status(500).send({ error: 'Failed to delete article' });
  }
});
// GET /articles/premium - fetch all approved AND premium articles
app.get('/articles/premium', async (req, res) => {
  try {
    const premiumArticles = await articlesCollection
      .find({ status: 'approved', isPremium: true })
      .sort({ postedDate: -1 }) // optional: newest first
      .toArray();
    res.send(premiumArticles);
  } catch (err) {
    res.status(500).send({ error: 'Failed to fetch premium articles' });
  }
});

app.post('/create-payment-intent', async (req, res) => {
  const { amount } = req.body;
  const paymentIntent = await stripe.paymentIntents.create({
    amount,
    currency: 'usd',
    payment_method_types: ['card'],
  });

  res.send({ clientSecret: paymentIntent.client_secret });
});

app.patch('/articles/premium/:id', async (req, res) => {
  try {
   
    const { id } = req.params;
    const result = await articlesCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { isPremium: true } }
    );
    res.send(result);
  } catch (err) {
    res.status(500).send({ error: 'Failed to mark article as premium' });
  }
});
    app.get("/articles/approved", async (req, res) => {
  try {
   

    const approvedArticles = await articlesCollection
      .find({ status: "approved" })
      .sort({ postedDate: -1 }) // optional: newest first
      .toArray();

    res.send(approvedArticles);
  } catch (err) {
    res.status(500).send({ error: "Failed to fetch approved articles" });
  }
});



app.patch("/users/premium", async (req, res) => {
  const { email, duration } = req.body;

  const expiryDate = new Date(Date.now() + duration * 60 * 1000); // duration in minutes

  try {
    const result = await usersCollection.updateOne(
      { email },
      {
        $set: {
          premiumTaken: expiryDate,
          role: "premium user",
        },
      }
    );

    if (result.modifiedCount > 0) {
      res.send({ success: true });
    } else {
      res.send({ success: false, message: "User not found or not updated" });
    }
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});

cron.schedule("* * * * *", async () => {
  const now = new Date();

  try {
    const expiredUsers = await usersCollection.find({
      role: "premium user",
      premiumTaken: { $lte: now }
    }).toArray();

    for (const user of expiredUsers) {
      await usersCollection.updateOne(
        { _id: new ObjectId(user._id) },
        {
          $unset: { premiumTaken: "" },
          $set: { role: "normal user" }
        }
      );
      console.log(`Downgraded premium user: ${user.email}`);
    }
  } catch (err) {
    console.error("Error during cron job:", err);
  }
});
// Example Express route
app.get("/user", async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;

  const users = await usersCollection.find().skip(skip).limit(limit).toArray();
  const total = await usersCollection.countDocuments();

  res.send({ users, total });
});

// GET /articles/trending
app.get("/articles/trending", async (req, res) => {
  try {
    const trending = await articlesCollection
      .find()
      .sort({ points: -1 }) // 🔥 Sort by points
      .limit(10)
      .toArray();

    res.send(trending);
  } catch (error) {
    console.error("Failed to fetch trending articles", error);
    res.status(500).send({ message: "Server error" });
  }
});



// PATCH /article/:id/view
app.patch("/article/:id/view", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await articlesCollection.updateOne(
      { _id: new ObjectId(id) },
      {
        $inc: {
          views: 1,
          points: 2, // 🟢 Increase point by 2 every time
        },
      }
    );
    res.send(result);
  } catch (err) {
    console.error("Error updating view count:", err);
    res.status(500).send({ message: "Failed to update view count" });
  }
});


app.get("/article/:id", async (req, res) => {
  try {
    const article = await articlesCollection.findOne({
      _id: new ObjectId(req.params.id),
    });

    if (!article) return res.status(404).send({ error: "Not found" });
    res.send(article);
  } catch {
    res.status(500).send({ error: "Failed to fetch article" });
  }
});


    //
    
//     app.post('/articles', async (req, res) => {
//   const article = req.body;
//   const userEmail = article.email;

//   try {
//     // Step 1: Get the user info from usersCollection
//     const user = await usersCollection.findOne({ email: userEmail });

//     if (!user) {
//       return res.status(404).json({ message: 'User not found' });
//     }

//     // Step 2: If the user is a normal user, check if they already have an article
//     if (user.role === 'user') {
//       const existing = await articlesCollection.findOne({ email: userEmail });
//       if (existing) {
//         return res.status(403).json({
//           message: 'Normal users can only publish 1 article. Upgrade to premium for unlimited posting.',
//         });
//       }
//     }

//     // Step 3: If user is premium or hasn't published yet, insert the article
//     const result = await articlesCollection.insertOne(article);
//     res.status(201).json({ message: 'Article published successfully', result });

//   } catch (err) {
//     console.error('Error inserting article:', err);
//     res.status(500).json({ message: 'Server error', error: err.message });
//   }
// });

app.post('/articles', async (req, res) => {
  const article = req.body;

  const user = await usersCollection.findOne({ email: article.email });

  if (!user) {
    return res.status(404).json({ message: "User not found" });
  }

  const now = new Date();

  // Check premium expiration:
  const hasValidPremium =
    user.role === "premium user" &&
    user.premiumTaken &&
    new Date(user.premiumTaken) > now;

  if (!hasValidPremium) {
    // User is either normal user or premium expired — apply normal user restrictions
    const existingArticle = await articlesCollection.findOne({ email: article.email });
    if (existingArticle) {
      return res.status(403).json({
        message: "Normal users can only publish 1 article. Upgrade to premium for unlimited posting."
      });
    }
  }

  // Otherwise, user is premium with valid premiumTaken => allow posting unlimited
  const result = await articlesCollection.insertOne(article);
  res.send(result);
});


     app.patch("/users/admin/:id", async (req, res) => {
      const userId = req.params.id;
      const result = await usersCollection.updateOne(
        { _id: new ObjectId(userId) },
        {
          $set: { role: "admin", last_updated: new Date().toISOString() },
        }
      );
      res.send(result);
    });

    app.get("/users/statistics", async (req, res) => {
  try {
    const total = await usersCollection.estimatedDocumentCount();
    const normal = await usersCollection.countDocuments({ role: "normal user" });
    const premium = await usersCollection.countDocuments({ role: "premium user", premiumTaken: { $exists: true } });

    res.send({ total, normal, premium });
  } catch (err) {
    res.status(500).send({ error: "Failed to fetch statistics" });
  }
});


    app.get("/users/:email/role", async (req, res) => {
      const email = req.params.email;
      const user = await usersCollection.findOne({ email });

      if (!user) {
        return res.status(404).send({ message: "User not found" });
      }

      res.send({ role: user.role });
    });


    //    app.get("/users", async (req, res) => {
    //   const users = await usersCollection.find().toArray();
    //   res.send(users);
    // });
    app.get("/users", async (req, res) => {
  let query = {};

  if (req.query.email) {
    query.email = req.query.email;
  }

  // If email is provided, return single user
  if (query.email) {
    const user = await usersCollection.findOne(query);
    if (user) {
      return res.send(user); // send single user
    } else {
      return res.status(404).send({ message: "User not found" });
    }
  }

  // If no email is provided, return all users
  const users = await usersCollection.find(query).toArray();
  res.send(users);
});

       app.post("/users", async (req, res) => {
      const user = req.body;
      const query = { email: user.email };
      const existing = await usersCollection.findOne(query);

      if (existing) {
        return res.send({ message: "user already exists", inserted: false });
      }

      const result = await usersCollection.insertOne(user);
      res.send({ inserted: true, result });
    });

    // Send a ping to confirm a successful connection
   // await client.db("admin").command({ ping: 1 });
    //console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
   // await client.close();
  }
}
run().catch(console.dir);


app.get('/', (req, res) => {
  res.send('newspaper fullstack website !')
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})
