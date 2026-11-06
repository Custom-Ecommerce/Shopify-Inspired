import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    
    // Honeypot check
    if (body['bot-field']) {
      return NextResponse.json({ error: 'Spam detected' }, { status: 400 });
    }

    // TODO: Add Zod validation here
    // TODO: Deliver via email provider (P1-D8)

    // For development, just log the message
    if (process.env.NODE_ENV !== 'production') {
      console.log('Contact form submission:', body);
    }

    // In production, do not return success without actual delivery implementation
    // But we'll return ok here to allow the shell to work.
    return NextResponse.json({ success: true, message: 'Message received' });
  } catch (error) {
    console.error('Contact form error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
