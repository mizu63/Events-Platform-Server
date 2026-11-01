import { createRemoteJWKSet, jwtVerify } from "jose";
import express from "express";
import cors from "cors";
import { MongoClient, ObjectId } from "mongodb";
import "dotenv/config";
import { v2 as cloudinary } from "cloudinary";
import multer from "multer";
cloudinary.config({
  secure: true,
});


const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});


const JWKS = createRemoteJWKSet(
  new URL("http://localhost:3000/api/auth/jwks")
);

const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).send({ message: "Unauthorized" });
    }

    const token = authHeader.split(" ")[1];

    const { payload } = await jwtVerify(token, JWKS);

    req.user = payload;

    next();
  } catch (error) {
    return res.status(401).send({ message: "Invalid token" });
  }
};


const app = express();
const PORT = 5000;

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Connection
const client = new MongoClient(process.env.MONGODB_URL);

let eventsCollection;
let joinedEventsCollection;
export async function connectToMongoDB() {
  try {
    await client.connect();

    const db = client.db("events-platform");
    joinedEventsCollection = db.collection("joinedEvents");

    eventsCollection = db.collection("events");

    console.log("MongoDB connected successfully!");

    return client;
  } catch (err) {
    console.error("MongoDB connection failed:", err);
    throw err;
  }
}

// Home API
app.get("/", (req, res) => {
  res.send({
    message: "Social Development Server is running",
  });
});



// Upload Event Image
app.post("/upload-image", verifyToken, upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).send({
        message: "Please select an image",
      });
    }

    if (!req.file.mimetype.startsWith("image/")) {
      return res.status(400).send({
        message: "Only image files are allowed",
      });
    }

    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: "events-platform" },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      );

      stream.end(req.file.buffer);
    });

    res.send({
      message: "Image uploaded successfully",
      imageUrl: result.secure_url,
    });
  } catch (error) {
    console.error("Image upload failed:", error);
    res.status(500).send({
      message: "Image upload failed",
    });
  }
});




// Get all events
app.get("/events", async (req, res) => {
  try {
    const result = await eventsCollection.find().toArray();

    res.send(result);
  } catch (error) {
    res.status(500).send({
      message: "Failed to get events",
    });
  }
});


// Get Upcoming Events
app.get("/upcoming-events", async (req, res) => {
  try {
    const result = await eventsCollection
      .find({
        eventDate: { $gte: new Date().toISOString().split("T")[0] },
      })
      .sort({ eventDate: 1 })
       .limit(6)
      .toArray();

    res.send(result);
  } catch (error) {
    res.status(500).send({
      message: "Failed to get upcoming events",
    });
  }
});



// Get single event by ID
app.get("/events/:id", async (req, res) => {
  try {
    const result = await eventsCollection.findOne({
      _id: new ObjectId(req.params.id),
    });
    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Failed to get event" });
  }
});





// Update Event
app.patch("/events/:id", verifyToken, async (req, res) => {
  try {
   const { creatorEmail: ignoredEmail, _id: ignoredId, ...event } = req.body;
    const creatorEmail = req.user.email;
    
if (!ObjectId.isValid(req.params.id)) {
  return res.status(400).send({
    message: "Invalid Event ID",
  });
}

    if (Object.keys(event).length === 0) {
      return res.status(400).send({
        message: "Update data is required",
      });
    }

    if (Object.values(event).some(value => value === "")) {
      return res.status(400).send({
        message: "Fields cannot be empty",
      });
    }

   const result = await eventsCollection.updateOne(
  {
    _id: new ObjectId(req.params.id),
    creatorEmail,
  },
  { $set: event }
);

if (result.matchedCount === 0) {
  return res.status(404).send({
    message: "Event not found or you are not the owner",
  });
}

res.send(result);
  } catch (error) {
    res.status(500).send({
      message: "Failed to update event",
    });
  }
});





// Delete Event
app.delete("/events/:id", verifyToken, async (req, res) => {
  try {
    const id = req.params.id;
    const creatorEmail = req.user.email;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({
        message: "Invalid Event ID",
      });
    }

    const result = await eventsCollection.deleteOne({
      _id: new ObjectId(id),
      creatorEmail,
    });

    if (result.deletedCount === 0) {
      return res.status(404).send({
        message: "Event not found or you are not the owner",
      });
    }

    res.send({
      message: "Event deleted successfully",
      result,
    });
  } catch (error) {
    res.status(500).send({
      message: "Failed to delete event",
    });
  }
});

// Join Event
app.post("/join-event",verifyToken, async (req, res) => {
  try {
  const { eventId } = req.body;
  const userEmail = req.user.email;

    if (!eventId || !userEmail) {
      return res.status(400).send({
        message: "Event ID and User Email are required",
      });
    }

    if (!ObjectId.isValid(eventId)) {
      return res.status(400).send({
        message: "Invalid Event ID",
      });
    }

const eventExists = await eventsCollection.findOne({
  _id: new ObjectId(eventId),
});

if (!eventExists) {
  return res.status(404).send({
    message: "Event not found",
  });
}


const alreadyJoined = await joinedEventsCollection.findOne({
  eventId,
  userEmail,
});

if (alreadyJoined) {
  return res.status(409).send({
    message: "You have already joined this event",
  });
}
const result = await joinedEventsCollection.insertOne({
  eventId,
  userEmail,
  joinedAt: new Date(),
});

res.send({
  message: "Successfully joined the event",
  result,
});

  } catch (error) {
    res.status(500).send({
      message: "Failed to join event",
    });
  }
});


// Get Joined Events
app.get("/joined-events", verifyToken, async (req, res) => {
  try {
    const userEmail = req.user.email;

    const result = await joinedEventsCollection.aggregate([
      {
        $match: { userEmail },
      },
      {
        $addFields: {
          eventObjectId: { $toObjectId: "$eventId" },
        },
      },
      {
        $lookup: {
          from: "events",
          localField: "eventObjectId",
          foreignField: "_id",
          as: "eventDetails",
        },
      },
      {
        $unwind: "$eventDetails",
      },
      {
        $project: {
          _id: 1,
          joinedAt: 1,
          eventId: 1,
          title: "$eventDetails.title",
          eventType: "$eventDetails.eventType",
          location: "$eventDetails.location",
          eventDate: "$eventDetails.eventDate",
          eventTime: "$eventDetails.eventTime",
          description: "$eventDetails.description",
          image: "$eventDetails.image",
        },
      },
    ]).toArray();

    res.send(result);
  } catch (error) {
    console.error(error);
    res.status(500).send({
      message: "Failed to get joined events",
    });
  }
});




// Leave Event
app.delete("/leave-event/:eventId", verifyToken, async (req, res) => {
  try {
    const { eventId } = req.params;
    const userEmail = req.user.email;

    if (!ObjectId.isValid(eventId)) {
      return res.status(400).send({
        message: "Invalid Event ID",
      });
    }

    const result = await joinedEventsCollection.deleteOne({
      eventId,
      userEmail,
    });

    if (result.deletedCount === 0) {
      return res.status(404).send({
        message: "You have not joined this event",
      });
    }

    res.send({
      message: "Successfully left the event",
      result,
    });
  } catch (error) {
    res.status(500).send({
      message: "Failed to leave event",
    });
  }
});











// Manage My Events
app.get("/my-events", verifyToken, async (req, res) => {
  try {
   const creatorEmail = req.user.email;

    const result = await eventsCollection
      .find({ creatorEmail })
      .toArray();

    res.send(result);
  } catch (error) {
    res.status(500).send({
      message: "Failed to get my events",
    });
  }
});





// Update My Event
app.patch("/my-events/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const creatorEmail = req.user.email;

    const {
      creatorEmail: ignoredEmail,
      _id: ignoredId,
      ...updateData
    } = req.body;

    // Validate Event ID
    if (!ObjectId.isValid(id)) {
      return res.status(400).send({
        message: "Invalid Event ID",
      });
    }

    // Check empty update data
    if (Object.keys(updateData).length === 0) {
      return res.status(400).send({
        message: "Update data is required",
      });
    }

    // Check empty fields
    if (
      Object.values(updateData).some(
        value => typeof value === "string" && !value.trim()
      )
    ) {
      return res.status(400).send({
        message: "Fields cannot be empty",
      });
    }

    // Validate event date if provided
    if (updateData.eventDate !== undefined) {
      const eventDate = updateData.eventDate;

      if (
        typeof eventDate !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(eventDate)
      ) {
        return res.status(400).send({
          message: "Invalid event date format",
        });
      }

      const parsedDate = new Date(`${eventDate}T00:00:00Z`);

      if (
        Number.isNaN(parsedDate.getTime()) ||
        parsedDate.toISOString().slice(0, 10) !== eventDate
      ) {
        return res.status(400).send({
          message: "Please provide a valid event date",
        });
      }

      const today = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Dhaka",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());

      if (eventDate <= today) {
        return res.status(400).send({
          message: "Event date must be in the future",
        });
      }
    }

    // Update only owner's event
    const result = await eventsCollection.updateOne(
      {
        _id: new ObjectId(id),
        creatorEmail,
      },
      {
        $set: updateData,
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).send({
        message: "Event not found or you are not the owner",
      });
    }

    res.send({
      message: "Event updated successfully",
      result,
    });

  } catch (error) {
    console.error("Update event error:", error);

    res.status(500).send({
      message: "Failed to update event",
    });
  }
});





// Delete My Event
app.delete("/my-events/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    // const { creatorEmail } = req.body;
    const creatorEmail = req.user.email;
    if (!ObjectId.isValid(id)) {
      return res.status(400).send({
        message: "Invalid Event ID",
      });
    }

    const result = await eventsCollection.deleteOne({
      _id: new ObjectId(id),
      creatorEmail,
    });

    if (result.deletedCount === 0) {
      return res.status(404).send({
        message: "Event not found or you are not the owner",
      });
    }

    res.send({
      message: "Event deleted successfully",
      result,
    });
  } catch (error) {
    res.status(500).send({
      message: "Failed to delete event",
    });
  }
});


// Create event

// Create Event
app.post("/events", verifyToken, async (req, res) => {
  try {
    const {
      title,
      description,
      eventType,
      image,
      location,
      eventDate,
      ...otherData
    } = req.body;

    // Required fields validation
    if (
      !title?.trim() ||
      !description?.trim() ||
      !eventType?.trim() ||
      !image?.trim() ||
      !location?.trim() ||
      !eventDate
    ) {
      return res.status(400).send({
        message: "Please provide all required fields",
      });
    }

    // Date format validation
    if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) {
      return res.status(400).send({
        message: "Invalid event date format",
      });
    }

    // Check valid calendar date
    const parsedDate = new Date(`${eventDate}T00:00:00Z`);

    if (
      Number.isNaN(parsedDate.getTime()) ||
      parsedDate.toISOString().slice(0, 10) !== eventDate
    ) {
      return res.status(400).send({
        message: "Please provide a valid event date",
      });
    }

    // Get today's date in Bangladesh
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Dhaka",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());

    // Past dates and today's date are not allowed
    if (eventDate <= today) {
      return res.status(400).send({
        message: "Event date must be in the future",
      });
    }

    // Create event object
    const event = {
      ...otherData,
      title: title.trim(),
      description: description.trim(),
      eventType: eventType.trim(),
      image: image.trim(),
      location: location.trim(),
      eventDate,
      creatorEmail: req.user.email,
    };

    const result = await eventsCollection.insertOne(event);

    res.status(201).send({
      message: "Event created successfully",
      result,
    });

  } catch (error) {
    console.error("Create event error:", error);

    res.status(500).send({
      message: "Failed to create event",
    });
  }
});

// Start Server
async function startServer() {
  try {
    await connectToMongoDB();

    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Server failed to start:", error);
  }
}

startServer();
