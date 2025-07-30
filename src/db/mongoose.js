import mongoose from 'mongoose';

export async function connectDB() {
  const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://laotrader23:ZMtCxf%25VnF5kLWA@cluster0.exebvmy.mongodb.net/myDatabase?retryWrites=true&w=majority&appName=Cluster0';
  // const MONGODB_URI = process.env.MONGODB_URI || 
  //   'mongodb://localhost:27017/weizen';


  try {
    await mongoose.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('✅ MongoDB Connected:', MONGODB_URI);
  } catch (err) {
    console.error('❌ MongoDB Connection Error:', err);
    process.exit(1);
  }
}
