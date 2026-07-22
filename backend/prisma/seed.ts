import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SAMPLE_USERS = [
  {
    id: "seed-user-1",
    name: "Sarah Chen",
    username: "sarahchen",
    email: "sarah@example.com",
    image: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200",
    bio: "Coffee lover & adventure seeker",
    location: "San Francisco, CA",
    coverPhoto: "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800",
  },
  {
    id: "seed-user-2",
    name: "Marcus Johnson",
    username: "marcusj",
    email: "marcus@example.com",
    image: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200",
    bio: "Music producer & weekend hiker",
    location: "Los Angeles, CA",
    coverPhoto: "https://images.unsplash.com/photo-1519638399535-1b036603ac77?w=800",
  },
  {
    id: "seed-user-3",
    name: "Emma Wilson",
    username: "emmawilson",
    email: "emma@example.com",
    image: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=200",
    bio: "Foodie, traveler, dog mom",
    location: "New York, NY",
    coverPhoto: "https://images.unsplash.com/photo-1470770903676-69b98201ea1c?w=800",
  },
  {
    id: "seed-user-4",
    name: "James Park",
    username: "jamespark",
    email: "james@example.com",
    image: "https://images.unsplash.com/photo-1463453091185-61582044d556?w=200",
    bio: "Photographer & late-night coder",
    location: "Seattle, WA",
    coverPhoto: "https://images.unsplash.com/photo-1501854140801-50d01698950b?w=800",
  },
  {
    id: "seed-user-5",
    name: "Olivia Martinez",
    username: "oliviam",
    email: "olivia@example.com",
    image: "https://images.unsplash.com/photo-1517841905240-472988babdf9?w=200",
    bio: "Yoga instructor & book lover",
    location: "Austin, TX",
    coverPhoto: "https://images.unsplash.com/photo-1494500764479-0c8f2919a3d8?w=800",
  },
];

async function main() {
  console.log("Seeding database...");

  // Clear existing seed data
  await prisma.post.deleteMany({ where: { userId: { in: SAMPLE_USERS.map((u) => u.id) } } });
  await prisma.user.deleteMany({ where: { id: { in: SAMPLE_USERS.map((u) => u.id) } } });

  // Create sample users
  for (const u of SAMPLE_USERS) {
    await prisma.user.upsert({
      where: { id: u.id },
      update: {},
      create: {
        id: u.id,
        name: u.name,
        username: u.username,
        email: u.email,
        image: u.image,
        bio: u.bio,
        location: u.location,
        coverPhoto: u.coverPhoto,
      },
    });
  }

  // Create sample posts
  const posts = [
    {
      userId: "seed-user-1",
      type: "music",
      content: "This song has been on repeat all morning!",
      musicTitle: "Golden Hour",
      musicArtist: "JVKE",
      musicAlbum: "this is what ____ feels like",
      musicMode: "now",
    },
    {
      userId: "seed-user-2",
      type: "location",
      content: "Best coffee in the city, no debate",
      locationName: "Blue Bottle Coffee",
      venueCategory: "coffee",
    },
    {
      userId: "seed-user-3",
      type: "food",
      content: "Homemade ramen on a rainy day hits different",
      mealName: "Homemade Ramen",
      image: "https://images.unsplash.com/photo-1569050467447-ce54b3bbc37d?w=600",
    },
    {
      userId: "seed-user-1",
      type: "sleep",
      sleepAction: "woke_up",
      sleepDuration: "7h 45m",
    },
    {
      userId: "seed-user-4",
      type: "activity",
      content: "Morning run along the waterfront — absolutely stunning",
      activityType: "Running",
      activityDuration: "45 min",
      image: "https://images.unsplash.com/photo-1571008887538-b36bb32f4571?w=600",
    },
    {
      userId: "seed-user-5",
      type: "thought",
      content: "Sometimes the smallest moments are the most beautiful. Take a breath. Be present.",
    },
    {
      userId: "seed-user-2",
      type: "music",
      content: "Studio session tonight",
      musicTitle: "Blinding Lights",
      musicArtist: "The Weeknd",
      musicAlbum: "After Hours",
      musicMode: "listened",
    },
    {
      userId: "seed-user-3",
      type: "location",
      content: "NYC never disappoints",
      locationName: "Central Park",
      venueCategory: "park",
      image: "https://images.unsplash.com/photo-1534430480872-3498386e7856?w=600",
    },
    {
      userId: "seed-user-4",
      type: "photo",
      content: "Golden hour from my office window",
      image: "https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?w=600",
    },
    {
      userId: "seed-user-1",
      type: "sleep",
      sleepAction: "sleeping",
    },
    {
      userId: "seed-user-5",
      type: "activity",
      content: "Yoga at sunrise. My favorite way to start the day.",
      activityType: "Yoga",
      activityDuration: "60 min",
    },
    {
      userId: "seed-user-2",
      type: "food",
      content: "Late night tacos because why not",
      mealName: "Street Tacos",
    },
    {
      userId: "seed-user-3",
      type: "music",
      content: "Walking through the park with this on",
      musicTitle: "As It Was",
      musicArtist: "Harry Styles",
      musicAlbum: "Harry's House",
      musicMode: "now",
    },
    {
      userId: "seed-user-4",
      type: "location",
      content: "Working remotely today",
      locationName: "JFK International Airport",
      venueCategory: "airport",
    },
    {
      userId: "seed-user-5",
      type: "thought",
      content: "Read a whole book today. First time in months. Felt amazing.",
    },
  ];

  // Insert posts with staggered dates
  for (let i = 0; i < posts.length; i++) {
    const createdAt = new Date(Date.now() - i * 2 * 60 * 60 * 1000); // 2 hours apart
    await prisma.post.create({
      data: { ...posts[i], createdAt } as any,
    });
  }

  // Add some friendships between seed users
  const friendPairs = [
    ["seed-user-1", "seed-user-2"],
    ["seed-user-1", "seed-user-3"],
    ["seed-user-2", "seed-user-4"],
    ["seed-user-3", "seed-user-5"],
  ];

  for (const pair of friendPairs) {
    const a = pair[0] as string;
    const b = pair[1] as string;
    await prisma.friendship.upsert({
      where: { requesterId_addresseeId: { requesterId: a, addresseeId: b } },
      update: {},
      create: { requesterId: a, addresseeId: b, status: "accepted" },
    });
  }

  console.log("Seed complete! Created", SAMPLE_USERS.length, "users and", posts.length, "posts");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
