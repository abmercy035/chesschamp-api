const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();
const User = require('./models/User');

async function createAdminUser() {
	try {
		await mongoose.connect(process.env.MONGODB_URI, {
			useNewUrlParser: true,
			useUnifiedTopology: true
		});
		console.log('✅ Connected to MongoDB');		// Check if admin user already exists
		let adminUser = await User.findOne({ username: 'admin' });

		if (adminUser) {
			// Update existing user to admin
			adminUser.isAdmin = true;
			adminUser.role = 'admin';
			await adminUser.save();
			console.log('✅ Updated existing user "admin" to admin role');
			console.log(`👤 Admin User: ${adminUser.username} (${adminUser.email || 'no email'})`);
		} else {
			// Create new admin user
			const hashedPassword = await bcrypt.hash('admin123', 10);

			adminUser = new User({
				username: 'admin',
				email: 'admin@chesschamp.com',
				password: hashedPassword,
				isAdmin: true,
				role: 'admin',
				profile: {
					displayName: 'Chess Tournament Admin',
					avatar: '👑',
					ranking: {
						elo: 2000,
						rank: 'Master',
						peakElo: 2000
					}
				}
			});

			await adminUser.save();
			console.log('✅ Created new admin user successfully!');
			console.log('👤 Username: admin');
			console.log('🔑 Password: admin123');
			console.log('📧 Email: admin@chesschamp.com');
		}

		// Also check for other potential admin users
		const allAdmins = await User.find({ $or: [{ isAdmin: true }, { role: 'admin' }] });
		console.log(`\n📊 Total admin users: ${allAdmins.length}`);
		allAdmins.forEach(admin => {
			console.log(`   - ${admin.username} (${admin.email || 'no email'}) - isAdmin: ${admin.isAdmin}, role: ${admin.role}`);
		});

		process.exit(0);
	} catch (error) {
		console.error('❌ Error creating admin user:', error);
		process.exit(1);
	}
}

createAdminUser();
