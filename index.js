import { SNSClient, PublishCommand } from "@aws-sdk/client-sns"; // AWS SDK v3
import sgMail from '@sendgrid/mail';
import { createConnection } from 'mysql2/promise';
import 'dotenv/config';

// Set SendGrid API Key
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// RDS configuration
const rdsConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_DATABASE,
};

// Initialize SNS client (v3)
const snsClient = new SNSClient({ region: process.env.AWS_REGION });

// Lambda handler function
export const handler = async (event) => {
    try {
        // Parse SNS message to extract user details
        const snsMessage = event.Records[0].Sns.Message;
        const userDetails = JSON.parse(snsMessage);
        const { email, first_name: firstName, id } = userDetails;

        // Generate verification link (expires in 2 minutes)
        const verificationLink = generateVerificationLink(email);

        // Send verification email via SendGrid
        await sendVerificationEmail(email, firstName, verificationLink);

        // Track email in RDS database
        await trackEmailInRDS(email, verificationLink);

        return { statusCode: 200, body: 'Email sent successfully' };
    } catch (error) {
        console.error('Error processing SNS message:', error);
        return { statusCode: 500, body: 'Failed to send email' };
    }
};

// Generate a unique verification link that expires after 2 minutes
function generateVerificationLink(email) {
    const expirationTime = new Date(Date.now() + 2 * 60 * 1000).toISOString();
    return `https://srijithmakam.me/verify?email=${email}&expires=${expirationTime}`;
}

// Send verification email using SendGrid
async function sendVerificationEmail(email, firstName, link) {
    const msg = {
        to: email,
        from: process.env.SENDGRID_VERIFIED_SENDER,
        subject: 'Welcome! Please verify your email',
        text: `Hello ${firstName},\n
        \nPlease click on the following link to verify your email address: ${link}. This link will expire in 2 minutes.\n
        \nIf you did not request this, please ignore this email.\n
        \nBest regards,
        \nSrijith Makam`,
        html: `<p>Hello ${firstName},</p>
        <p>Please click on the following link to verify your email address: <a href="${link}">${link}</a></p>
        <p>This link will expire in 2 minutes.</p>
        <p>If you did not request this, please ignore this email.</p>
        <p>Best regards,<br>Srijith Makam</p>`,
    };
    await sgMail.send(msg);
}

// Track the sent email in RDS database
async function trackEmailInRDS(email, link) {
    const connection = await createConnection(rdsConfig);
    const query = 'INSERT INTO email_tracking (email, verification_link) VALUES (?, ?)';
    await connection.execute(query, [email, link]);
    await connection.end();
}