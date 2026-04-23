declare module "nodemailer" {
  export type Transporter = {
    sendMail(options: {
      from?: string;
      to: string;
      subject: string;
      html?: string;
      text?: string;
    }): Promise<unknown>;
  };

  const nodemailer: {
    createTransport(options: {
      host?: string;
      port?: number;
      secure?: boolean;
      auth?: {
        user: string;
        pass: string;
      };
    }): Transporter;
  };

  export default nodemailer;
}
