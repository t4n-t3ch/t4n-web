import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

// Define error type
type SyncError = {
  message: string;
};

export async function GET(req: NextRequest) {
  try {
    // Initialize Stripe inside the function
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
    
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Verify cron secret to prevent unauthorized access
    const authHeader = req.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const results = {
      syncedSubscriptions: 0,
      errors: [] as string[]
    };

    // Get all active subscriptions from database
    const { data: subscriptions } = await supabase
      .from('subscriptions')
      .select('stripe_subscription_id, user_id, status')
      .in('status', ['active', 'past_due', 'trialing']);

    for (const sub of subscriptions || []) {
      try {
        // Fetch from Stripe
        const stripeSub = await stripe.subscriptions.retrieve(sub.stripe_subscription_id);
        
        // Update if status changed
        if (stripeSub.status !== sub.status) {
          await supabase
            .from('subscriptions')
            .update({ 
              status: stripeSub.status,
              updated_at: new Date().toISOString()
            })
            .eq('stripe_subscription_id', sub.stripe_subscription_id);

          // If subscription ended, downgrade user
          if (['canceled', 'unpaid', 'incomplete_expired'].includes(stripeSub.status)) {
            await supabase
              .from('users')
              .update({ plan: 'free' })
              .eq('id', sub.user_id);
          }
          
          results.syncedSubscriptions++;
        }
      } catch (error) {
        // Properly type the error
        const err = error as Error;
        results.errors.push(`Failed to sync ${sub.stripe_subscription_id}: ${err.message}`);
      }
    }

    return NextResponse.json({ 
      success: true, 
      timestamp: new Date().toISOString(),
      results 
    });
  } catch (error) {
    console.error('Nightly sync failed:', error);
    const err = error as Error;
    return NextResponse.json(
      { error: 'Sync failed', details: err.message },
      { status: 500 }
    );
  }
}