const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: process.env.SMTP_PORT || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const templates = {
  welcome: (data) => ({
    subject: "Welcome to Peer Tutoring Platform!",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #2c3e50;">Welcome ${data.firstName}!</h1>
        <p>Thank you for joining our peer tutoring platform. We're excited to help you on your learning journey.</p>
        <p>To get started, please verify your email address by clicking the button below:</p>
        <a href="${data.verificationLink}" style="display: inline-block; background-color: #3498db; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin: 20px 0;">Verify Email</a>
        <p>If you have any questions, feel free to reach out to our support team.</p>
        <p>Happy learning!</p>
      </div>
    `,
  }),

  "password-reset": (data) => ({
    subject: "Password Reset Request",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #2c3e50;">Password Reset</h1>
        <p>Hi ${data.firstName},</p>
        <p>You requested a password reset for your account. Click the button below to reset your password:</p>
        <a href="${data.resetLink}" style="display: inline-block; background-color: #e74c3c; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin: 20px 0;">Reset Password</a>
        <p>This link will expire in 1 hour for security reasons.</p>
        <p>If you didn't request this reset, please ignore this email.</p>
      </div>
    `,
  }),

  "session-booking-tutor": (data) => ({
    subject: "New Session Booking",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #2c3e50;">New Session Booking</h1>
        <p>Hi ${data.tutorName},</p>
        <p>You have a new session booking from ${data.studentName}!</p>
        <div style="background-color: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0;">
          <p><strong>Subject:</strong> ${data.subject}</p>
          <p><strong>Date:</strong> ${new Date(
            data.scheduledStart
          ).toLocaleDateString()}</p>
          <p><strong>Time:</strong> ${new Date(
            data.scheduledStart
          ).toLocaleTimeString()} - ${new Date(
      data.scheduledEnd
    ).toLocaleTimeString()}</p>
        </div>
        <p>Please log in to your dashboard to confirm this session.</p>
      </div>
    `,
  }),

  "session-booking-student": (data) => ({
    subject: "Session Booking Confirmation",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #2c3e50;">Session Confirmed</h1>
        <p>Hi ${data.studentName},</p>
        <p>Your session booking has been confirmed!</p>
        <div style="background-color: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0;">
          <p><strong>Tutor:</strong> ${data.tutorName}</p>
          <p><strong>Subject:</strong> ${data.subject}</p>
          <p><strong>Date:</strong> ${new Date(
            data.scheduledStart
          ).toLocaleDateString()}</p>
          <p><strong>Time:</strong> ${new Date(
            data.scheduledStart
          ).toLocaleTimeString()} - ${new Date(
      data.scheduledEnd
    ).toLocaleTimeString()}</p>
        </div>
        <p>You'll receive a reminder 24 hours before your session.</p>
      </div>
    `,
  }),

  "session-reminder": (data) => ({
    subject: "Upcoming Session Reminder",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #2c3e50;">Session Reminder</h1>
        <p>Hi ${data.name},</p>
        <p>This is a reminder that you have an upcoming tutoring session in 24 hours.</p>
        <div style="background-color: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0;">
          <p><strong>${
            data.role === "student" ? "Tutor" : "Student"
          }:</strong> ${data.otherParty}</p>
          <p><strong>Subject:</strong> ${data.subject}</p>
          <p><strong>Date:</strong> ${new Date(
            data.scheduledStart
          ).toLocaleDateString()}</p>
          <p><strong>Time:</strong> ${new Date(
            data.scheduledStart
          ).toLocaleTimeString()} - ${new Date(
      data.scheduledEnd
    ).toLocaleTimeString()}</p>
          ${
            data.location?.meetingLink
              ? `<p><strong>Meeting Link:</strong> <a href="${data.location.meetingLink}">${data.location.meetingLink}</a></p>`
              : ""
          }
        </div>
        <p>Make sure you're prepared and ready for your session!</p>
      </div>
    `,
  }),

  "session-reschedule": (data) => ({
    subject: "Session Rescheduled",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #f39c12;">Session Rescheduled</h1>
        <p>Hi ${data.name},</p>
        <p>${data.reschedulerName} has rescheduled your upcoming session.</p>
        <div style="background-color: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0;">
          <p><strong>Subject:</strong> ${data.subject}</p>
          <p><strong>New Date:</strong> ${new Date(
            data.newStart
          ).toLocaleDateString()}</p>
          <p><strong>New Time:</strong> ${new Date(
            data.newStart
          ).toLocaleTimeString()} - ${new Date(
      data.newEnd
    ).toLocaleTimeString()}</p>
          ${data.reason ? `<p><strong>Reason:</strong> ${data.reason}</p>` : ""}
        </div>
        <p>Please check your dashboard for the updated details.</p>
      </div>
    `,
  }),

  "session-cancellation": (data) => ({
    subject: "Session Cancelled",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #e74c3c;">Session Cancelled</h1>
        <p>Hi ${data.name},</p>
        <p>${data.cancellerName} has cancelled your upcoming session.</p>
        <div style="background-color: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0;">
          <p><strong>Subject:</strong> ${data.subject}</p>
          <p><strong>Scheduled Date:</strong> ${new Date(
            data.scheduledStart
          ).toLocaleDateString()}</p>
          <p><strong>Scheduled Time:</strong> ${new Date(
            data.scheduledStart
          ).toLocaleTimeString()}</p>
          <p><strong>Reason:</strong> ${data.reason}</p>
        </div>
        <p>You can book a new session through your dashboard.</p>
      </div>
    `,
  }),
};

async function sendEmail({ to, subject, template, data, html }) {
  try {
    let emailContent;

    if (template && templates[template]) {
      emailContent = templates[template](data);
    } else {
      emailContent = { subject, html };
    }

    const mailOptions = {
      from: process.env.SMTP_FROM || "noreply@peertutoring.com",
      to,
      subject: emailContent.subject,
      html: emailContent.html,
    };

    const result = await transporter.sendMail(mailOptions);
    console.log("Email sent successfully:", result.messageId);
    return result;
  } catch (error) {
    console.error("Error sending email:", error);
    throw error;
  }
}

module.exports = { sendEmail };
