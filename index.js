require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const admin = require("firebase-admin");
const port = process.env.PORT || 3000;
const decoded = Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString(
  "utf-8"
);
const serviceAccount = JSON.parse(decoded);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const app = express();
// middleware
app.use(
  cors({
    origin: [process.env.CLINT_DOMAIN],
    credentials: true,
    optionSuccessStatus: 200,
  })
);
app.use(express.json());

// jwt middlewares.........
const verifyJWT = async (req, res, next) => {
  const token = req?.headers?.authorization?.split(" ")[1];
  console.log(token);
  if (!token) return res.status(401).send({ message: "Unauthorized Access!" });
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.tokenEmail = decoded.email;
    console.log(decoded);
    next();
  } catch (err) {
    console.log(err);
    return res.status(401).send({ message: "Unauthorized Access!", err });
  }
};

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});
async function run() {
  try {
    // save plant data in Db
    const db = client.db("plantsDB");
    const plantsCollection = db.collection("plants");
    const orderCollection = db.collection("orders");
    const usersCollection = db.collection("users");
    const sellerRequestCollection = db.collection("sellerRequest");

    //?* plant data post
    app.get("/plants", async (req, res) => {
      const result = await plantsCollection.find().toArray();
      res.send(result);
    });

    app.get("/plants/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await plantsCollection.findOne(query);
      res.send(result);
    });

    app.post("/plants", async (req, res) => {
      const plantData = req.body;
      const result = await plantsCollection.insertOne(plantData);
      res.send(result);
    });

    //! paymen points
    app.post("/create-checkout-session", async (req, res) => {
      const paymentInfo = req.body;
      const amount = paymentInfo?.price * 100;
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "USD",
              unit_amount: amount,
              product_data: {
                name: paymentInfo?.name,
                discription: paymentInfo?.discription,
                images: [paymentInfo?.image],
              },
            },
            quantity: paymentInfo?.quantity,
          },
        ],
        customer_email: paymentInfo.customer.email,
        mode: "payment",
        metadata: {
          plantId: paymentInfo?.plantId,
          customer: paymentInfo?.customer.email,
        },
        success_url: `${process.env.CLINT_DOMAIN}/paymentSuccess?session_id={CHECKOUT_SESSION_ID}`,
        // success_url: `${process.env.CLINT_DOMAIN}/paymentSuccess?success=true`,
        cancel_url: `${process.env.CLINT_DOMAIN}/plant/${paymentInfo?.plantId}`,
      });

      // res.redirect(303, session.url);
      res.send({ url: session.url });
    });
    // payment sucess
    app.post("/paymentSuccess", async (req, res) => {
      const { sessionId } = req.body;
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      const plant = await plantsCollection.findOne({
        _id: new ObjectId(session.metadata.plantId),
      });
      const order = await orderCollection.findOne({
        transactionId: session.payment_intent,
      });

      if (session.status === "complete" && plant && !order) {
        // save db
        const orderInfo = {
          plantId: session.metadata.plantId,
          transactionId: session.payment_intent,
          customer: session.metadata.customer,
          status: "pending",
          seller: plant.seller,
          name: plant.name,
          category: plant.category,
          quantity: 1,
          price: session.amount_total / 100,
          image: plant?.image,
        };
        const result = await orderCollection.insertOne(orderInfo);
        // update plant quentity
        await plantsCollection.updateOne(
          {
            _id: new ObjectId(session.metadata.plantId),
          },
          {
            $inc: { quantity: -1 },
          }
        );
        return res.send({
          transactionId: session.payment_intent,
          orderId: result.insertedId,
        });
      }
      res.send(
        res.send({ transactionId: session.payment_intent, orderId: order._id })
      );
    });

    // get all orders for a customer by email
    app.get("/my-orders", verifyJWT, async (req, res) => {
      const email = req.tokenEmail;
      const result = await orderCollection.find({ customer: email }).toArray();
      res.send(result);
    });

    // get all plants of seller
    app.get("/my-inventory/:email", async (req, res) => {
      const email = req.params.email;
      const result = await plantsCollection
        .find({ "seller.email": email })
        .toArray();
      res.send(result);
    });
    // delete inventory data
    app.delete("/my-inventory/:id", async (req, res) => {
      const id = req.params.id;
      const result = await plantsCollection.deleteOne({
        _id: new ObjectId(id),
      });

      res.send(result);
    });

    // get all orders for seller
    app.get("/manage-orders/:email", async (req, res) => {
      const email = req.params.email;
      const result = await orderCollection
        .find({ "seller.email": email })
        .toArray();
      res.send(result);
    });

    // !--save or update-----users--------------------

    app.post("/user", async (req, res) => {
      const userData = req.body;
      userData.created_at = new Date().toISOString();
      userData.last_login = new Date().toISOString();
      userData.role = "customer";
      const query = { email: userData.email };
      const alreadyExit = await usersCollection.findOne(query);
      // console.log("alerady exixt sir", !!alreadyExit);
      if (alreadyExit) {
        // console.log("updating info..............");
        const result = await usersCollection.updateOne(query, {
          $set: { last_login: new Date.toISOString() },
        });
        return res.send(result);
      }
      // console.log("saving new info..............");
      const result = await usersCollection.insertOne(userData);
      res.send(result);
    });
    // role------------/user/role/:email------
    app.get("/user/role", verifyJWT, async (req, res) => {
      const email = req.tokenEmail;
      const result = await usersCollection.findOne({ email });
      res.send({ role: result?.role });
    });
    // seller req-------------
    app.post("/become-seller", verifyJWT, async (req, res) => {
      const email = req.tokenEmail;

      const alreadyExit = await sellerRequestCollection.findOne({ email });

      if (alreadyExit) {
        return res
          .status(403)
          .send({ message: "Already requested, Wait for Admin review" });
      }

      const result = await sellerRequestCollection.insertOne({ email });
      res.send(result);
    });
    // !---------------------------------
    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello from Server..");
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
