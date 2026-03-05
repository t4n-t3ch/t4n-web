import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get('stripe-signature')!;

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        const session = event.data.object;
        
        // Update user to pro
        await supabase
          .from('users')
          .update({ 
            plan: 'pro', 
            stripe_customer_id: session.customer,
            updated_at: new Date().toISOString()
          })
          .eq('id', session.metadata?.userId);
        
        // Create subscription record
        await supabase
          .from('subscriptions')
          .insert({
            user_id: session.metadata?.userId,
            stripe_subscription_id: session.subscription,
            stripe_customer_id: session.customer,
            status: 'active',
            plan_type: 'pro',
            created_at: new Date().toISOString()
          });
        break;
      
      case 'customer.subscription.deleted':
        const subscription = event.data.object;
        
        // Downgrade user to free
        await supabase
          .from('users')
          .update({ 
            plan: 'free',
            updated_at: new Date().toISOString()
          })
          .eq('stripe_customer_id', subscription.customer);
        
        // Update subscription status
        await supabase
          .from('subscriptions')
          .update({ 
            status: 'canceled',
            updated_at: new Date().toISOString()
          })
          .eq('stripe_subscription_id', subscription.id);
        break;

      case 'invoice.payment_succeeded':
        console.log('Payment succeeded:', event.data.object);
        break;

      case 'invoice.payment_failed':
        console.log('Payment failed:', event.data.object);
        break;
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Webhook processing failed:', error);
    return NextResponse.json({ error: 'Webhook failed' }, { status: 500 });
  }
}

// Remove this entire block:
// export const config = {
//   api: {
//     bodyParser: false,
//   },
// };