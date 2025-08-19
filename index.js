
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const cron = require("node-cron");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

// --- App & Middleware ---
const app = express();
const PORT = process.env.PORT || 3000;
app.use(cors());
app.use(express.json());

// --- HTTP server + Socket.IO (MUST use http server, not app.listen) ---
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // set your frontend origin in production
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE"],
  },
});

io.on("connection", (socket) => {
  console.log("🔌 Socket connected:", socket.id);
  socket.on("disconnect", () => console.log("❌ Socket disconnected:", socket.id));
});

// --- MongoDB client ---
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.mos4qzt.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
const client = new MongoClient(uri, {
  serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true },
});

// --- Main runner to init DB + routes ---
async function run() {
  try {
    await client.connect();
    const db = client.db("newspaperDB");
    const articlesCollection = db.collection("articles");
    const usersCollection = db.collection("users");
    const publisherCollection = db.collection("publishers");
    const notificationsCollection = db.collection("notifications");

    // ----------------------------
    // Health / Root
    // ----------------------------
    app.get("/", (req, res) => res.send("Newspaper fullstack backend ✅"));
    app.get("/healthz", (req, res) => res.status(200).send({ ok: true }));

    // ----------------------------
    // PUBLISHERS
    // ----------------------------
    app.get("/publishers", async (req, res) => {
      const publishers = await publisherCollection.find().toArray();
      res.send(publishers);
    });

    app.post("/publishers", async (req, res) => {
      const publisher = req.body;
      const result = await publisherCollection.insertOne(publisher);
      res.send(result);
    });

    // ----------------------------
    // ARTICLES (list, paginate)
    // ----------------------------
    app.get("/articles", async (req, res) => {
      const query = req.query.email ? { email: req.query.email } : {};
      const articles = await articlesCollection.find(query).toArray();
      res.send(articles);
    });

    app.get("/article", async (req, res) => {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const skip = (page - 1) * limit;

      const query = req.query.email ? { email: req.query.email } : {};
      const total = await articlesCollection.countDocuments(query);
      const data = await articlesCollection.find(query).skip(skip).limit(limit).toArray();
      res.send({ total, data });
    });

    // ----------------------------
    // ARTICLES (filters / approved / premium / trending)
    // ----------------------------
    app.get("/article/approve", async (req, res) => {
      try {
        const { title, publisher, tags } = req.query;
        const filter = { status: "approved" };
        if (title) filter.title = { $regex: title, $options: "i" };
        if (publisher) filter.publisher = publisher;
        if (tags) filter.tags = { $in: tags.split(",") };

        const articles = await articlesCollection.find(filter).sort({ postedDate: -1 }).toArray();
        res.send(articles);
      } catch (err) {
        console.error("Error fetching approved:", err);
        res.status(500).send({ error: "Failed to fetch approved articles" });
      }
    });

    app.get("/articles/approved", async (req, res) => {
      const approvedArticles = await articlesCollection
        .find({ status: "approved" })
        .sort({ postedDate: -1 })
        .toArray();
      res.send(approvedArticles);
    });

    app.get("/articles/premium", async (req, res) => {
      try {
        const premiumArticles = await articlesCollection
          .find({ status: "approved", isPremium: true })
          .sort({ postedDate: -1 })
          .toArray();
        res.send(premiumArticles);
      } catch (err) {
        res.status(500).send({ error: "Failed to fetch premium articles" });
      }
    });

    app.get("/articles/trending", async (req, res) => {
      try {
        const trending = await articlesCollection.find().sort({ points: -1 }).limit(10).toArray();
        res.send(trending);
      } catch (err) {
        console.error("Trending error:", err);
        res.status(500).send({ message: "Server error" });
      }
    });

    app.get("/articles/mostreads", async (req, res) => {
      try {
        const mostReads = await articlesCollection.find().sort({ points: -1 }).limit(6).toArray();
        res.send(mostReads);
      } catch (err) {
        console.error("Most reads error:", err);
        res.status(500).send({ message: "Server error" });
      }
    });

    // ----------------------------
    // TAGS
    // ----------------------------
    app.get("/tags", async (req, res) => {
      try {
        const tags = await articlesCollection
          .aggregate([
            { $match: { tags: { $exists: true, $ne: [] } } },
            { $unwind: "$tags" },
            { $group: { _id: "$tags" } },
            { $sort: { _id: 1 } },
          ])
          .toArray();

        res.send(tags.map((t) => t._id));
      } catch (err) {
        console.error("Tags error:", err);
        res.status(500).send({ error: "Failed to fetch tags" });
      }
    });

    // ----------------------------
    // ARTICLE CRUD
    // ----------------------------
    app.post("/articles", async (req, res) => {
      const article = req.body;

      const user = await usersCollection.findOne({ email: article.email });
      if (!user) return res.status(404).json({ message: "User not found" });

      const now = new Date();
      const hasValidPremium =
        user.role === "premium user" && user.premiumTaken && new Date(user.premiumTaken) > now;

      if (!hasValidPremium) {
        const existingArticle = await articlesCollection.findOne({ email: article.email });
        if (existingArticle) {
          return res.status(403).json({
            message: "Normal users can only publish 1 article. Upgrade to premium for unlimited posting.",
          });
        }
      }

      const result = await articlesCollection.insertOne(article);
      res.send(result);
    });

    app.put("/article/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const updateData = req.body;
        const result = await articlesCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: {
              title: updateData.title,
              image: updateData.image,
              description: updateData.description,
              publisher: updateData.publisher,
              tags: updateData.tags,
              status: "pending",
              updated_at: new Date(),
            },
          }
        );
        if (result.matchedCount === 0) return res.status(404).send({ error: "Article not found" });
        res.send({ message: "Article updated successfully", result });
      } catch (err) {
        console.error("Update article error:", err);
        res.status(500).send({ error: "Failed to update article" });
      }
    });

    app.patch("/articles/:id", async (req, res) => {
      const articleId = req.params.id;
      const updatedData = req.body;
      const result = await articlesCollection.updateOne(
        { _id: new ObjectId(articleId) },
        { $set: updatedData }
      );
      res.send(result);
    });

    app.delete("/articles/:id", async (req, res) => {
      const { id } = req.params;
      const result = await articlesCollection.deleteOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    // single article
    app.get("/article/:id", async (req, res) => {
      try {
        const article = await articlesCollection.findOne({ _id: new ObjectId(req.params.id) });
        if (!article) return res.status(404).send({ error: "Not found" });
        res.send(article);
      } catch (err) {
        res.status(500).send({ error: "Failed to fetch article" });
      }
    });

    // approve / decline / premium flag
    app.patch("/articles/approve/:id", async (req, res) => {
      const { id } = req.params;
      const result = await articlesCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status: "approved", postedDate: new Date().toISOString(), declineReason: "" } }
      );
      res.send(result);
    });

    app.patch("/articles/decline/:id", async (req, res) => {
      const { id } = req.params;
      const { reason } = req.body;
      if (!reason) return res.status(400).json({ error: "Reason is required" });

      const result = await articlesCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status: "declined", declineReason: reason } }
      );
      res.send(result);
    });

    app.patch("/articles/premium/:id", async (req, res) => {
      const { id } = req.params;
      const result = await articlesCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { isPremium: true } }
      );
      res.send(result);
    });

    // increment views/points
    app.patch("/article/:id/view", async (req, res) => {
      const { id } = req.params;
      const result = await articlesCollection.updateOne(
        { _id: new ObjectId(id) },
        { $inc: { views: 1, points: 2 } }
      );
      res.send(result);
    });

    // ----------------------------
    // USERS
    // ----------------------------
    app.get("/users", async (req, res) => {
      const { email } = req.query;
      if (email) {
        const user = await usersCollection.findOne({ email });
        return user ? res.send(user) : res.status(404).send({ message: "User not found" });
      }
      const users = await usersCollection.find().toArray();
      res.send(users);
    });

    // paginated users
    app.get("/user", async (req, res) => {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const skip = (page - 1) * limit;

      const users = await usersCollection.find().skip(skip).limit(limit).toArray();
      const total = await usersCollection.countDocuments();
      res.send({ users, total });
    });


  app.post("/users", async (req, res) => {
  const user = req.body;
  const existing = await usersCollection.findOne({ email: user.email });
  if (existing) return res.send({ message: "user already exists", inserted: false });

  const result = await usersCollection.insertOne(user);

  const notification = {
    email: user.email,
    name: user.name,
    type: "registered",
    time: new Date(),
  };
  await notificationsCollection.insertOne(notification);

  io.emit("user_registered", notification);

  res.send({ inserted: true, result });
});


    app.get("/users/:email/role", async (req, res) => {
      const user = await usersCollection.findOne({ email: req.params.email });
      if (!user) return res.status(404).send({ message: "User not found" });
      res.send({ role: user.role });
    });

    app.patch("/users/admin/:id", async (req, res) => {
      const result = await usersCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: { role: "admin", last_updated: new Date().toISOString() } }
      );
      res.send(result);
    });

    // upgrade to premium (duration: 1 => 1 minute test; otherwise days)
    app.patch("/users/premium", async (req, res) => {
      const { email, duration } = req.body;
      if (!email || !duration) {
        return res.status(400).send({ success: false, message: "Email and duration are required." });
      }

      const expiryDate =
        duration === 1
          ? new Date(Date.now() + 1 * 60 * 1000)
          : new Date(Date.now() + duration * 24 * 60 * 60 * 1000);

      const result = await usersCollection.updateOne(
        { email },
        { $set: { premiumTaken: expiryDate, role: "premium user" } }
      );

      if (result.modifiedCount > 0) {
        res.send({ success: true, message: "User upgraded to premium.", expiryDate });
      } else {
        res.send({ success: false, message: "User not found or update failed." });
      }
    });

    app.get("/users/statistics", async (req, res) => {
      try {
        const total = await usersCollection.estimatedDocumentCount();
        const normal = await usersCollection.countDocuments({ role: "normal user" });
        const premium = await usersCollection.countDocuments({
          role: "premium user",
          premiumTaken: { $exists: true },
        });
        res.send({ total, normal, premium });
      } catch (err) {
        res.status(500).send({ error: "Failed to fetch statistics" });
      }
    });

  

   
app.post("/login", async (req, res) => {
  const { email } = req.body;

  try {
    const user = await usersCollection.findOne({ email });
    if (!user) return res.status(404).send({ error: "User not found" });

    const now = new Date();
    await usersCollection.updateOne(
      { email },
      { $set: { last_log_in: now } }
    );

    const notification = {
      email,
      name: user.name,   // include user's name
      type: "login",
      time: now,
    };

    await notificationsCollection.insertOne(notification);
    io.emit("user_activity", notification);

    res.send({ message: "Login successful", notification });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).send({ error: "Failed to login" });
  }
});

// LOGOUT
app.post("/logout", async (req, res) => {
  const { email } = req.body;

  try {
    const user = await usersCollection.findOne({ email });
    if (!user) return res.status(404).send({ error: "User not found" });

    const now = new Date();
    await usersCollection.updateOne(
      { email },
      { $set: { last_log_out: now } }
    );

    const notification = {
      email,
      name: user.name,   // include user's name
      type: "logout",
      time: now,
    };

    await notificationsCollection.insertOne(notification);
    io.emit("user_activity", notification);

    res.send({ message: "Logout successful", notification });
  } catch (err) {
    console.error("Logout error:", err);
    res.status(500).send({ error: "Failed to logout" });
  }
});


 app.get("/admin/notifications", async (req, res) => {
  try {
    const notifications = await notificationsCollection
      .find()
      .sort({ time: -1 }) // newest first
      .toArray();

    res.send(notifications);
  } catch (err) {
    console.error("Failed to fetch notifications:", err);
    res.status(500).send({ error: "Failed to fetch notifications" });
  }
});


    // ----------------------------
    // STRIPE
    // ----------------------------
    app.post("/create-payment-intent", async (req, res) => {
      const { amount } = req.body;
      const paymentIntent = await stripe.paymentIntents.create({
        amount,
        currency: "usd",
        payment_method_types: ["card"],
      });
      res.send({ clientSecret: paymentIntent.client_secret });
    });

    // ----------------------------
    // CRON: downgrade expired premium users (every minute)
    // ----------------------------
    cron.schedule("* * * * *", async () => {
      const now = new Date();
      try {
        const expiredUsers = await usersCollection
          .find({ role: "premium user", premiumTaken: { $lte: now } })
          .toArray();

        for (const user of expiredUsers) {
          await usersCollection.updateOne(
            { _id: new ObjectId(user._id) },
            { $unset: { premiumTaken: "" }, $set: { role: "normal user" } }
          );
          console.log(`⬇️ Downgraded premium user: ${user.email}`);
        }
      } catch (err) {
        console.error("Cron error:", err);
      }
    });

    // ----------------------------
    // START SERVER (single place)
    // ----------------------------
    server.listen(PORT, () => {
      console.log(`🚀 Server + Socket.IO running on port ${PORT}`);
    });
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
}

run().catch(console.error);

// Graceful shutdown (optional)
process.on("SIGINT", async () => {
  try {
    await client.close();
  } catch {}
  process.exit(0);
});
