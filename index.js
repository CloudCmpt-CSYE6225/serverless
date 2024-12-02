import { SNSClient, PublishCommand } from "@aws-sdk/client-sns"; // AWS SDK v3
import sgMail from '@sendgrid/mail';
import { createConnection } from 'mysql2/promise';
import 'dotenv/config';
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

// Initialize SNS client (v3)
const snsClient = new SNSClient({ region: process.env.REGION });


async function getSecretValue(secretName) {
    const client = new SecretsManagerClient({ region: process.env.REGION });
    const command = new GetSecretValueCommand({ SecretId: secretName });
    const response = await client.send(command);
    if (response.SecretString) {
        return JSON.parse(response.SecretString);
    }
    throw new Error('Secret not found or is in binary form');
}

// Lambda handler function
export const handler = async (event) => {
    try {

        // Retrieve secrets
        const sendgridSecrets = await getSecretValue(process.env.sendgrid_credentials_name);
        const dbSecrets = await getSecretValue(process.env.rds_db_password_name);

        // Set SendGrid API Key
        sgMail.setApiKey(sendgridSecrets.sendgrid_api_key);

        // RDS configuration
        const rdsConfig = {
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: dbSecrets.DB_PASS,
            database: process.env.DB_DATABASE,
        };

        // Parse SNS message to extract user details
        const snsMessage = event.Records[0].Sns.Message;
        const userDetails = JSON.parse(snsMessage);
        const {  email, first_name: firstName, id, token } = userDetails;

        // Generate verification link (expires in 2 minutes)
        const verificationLink = generateVerificationLink(email, id);

        // Send verification email via SendGrid
        await sendVerificationEmail(email, firstName, verificationLink, sendgridSecrets.sendgrid_verified_sender);

        // Track email in RDS database
        await trackEmailInRDS(email, verificationLink, id, id, rdsConfig);

        return { statusCode: 200, body: 'Email sent successfully' };
    } catch (error) {
        console.error('Error processing SNS message:', error);
        return { statusCode: 500, body: 'Failed to send email' };
    }
};

// Generate a unique verification link that expires after 2 minutes
function generateVerificationLink(email, token) {
    return `https://${process.env.environment}.srijithmakam.me/v1/user/verify?email=${email}&token=${token}`;
}

// Send verification email using SendGrid
async function sendVerificationEmail(email, firstName, link, verifiedSender) {
    const msg = {
        to: email,
        from: verifiedSender,
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
async function trackEmailInRDS(email, link, id, token, rdsConfig) {
    const connection = await createConnection(rdsConfig);
    const query = 'INSERT INTO email_tracking (email, verification_link, user_id, token, created_at) VALUES (?, ?, ?, ?, ?)';
    await connection.execute(query, [email, link, id, token, new Date().toISOString()]);
    await connection.end();
}