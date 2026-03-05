/* eslint-disable @typescript-eslint/no-unused-vars */
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

// Initialize Stripe inside the function to avoid build-time errors
export async function POST(_req: NextRequest) {
    try {
        // Initialize Stripe inside the route handler
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
        
        const cookieStore = cookies();
        const supabase = createServerClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            {
                cookies: {
                    get(name: string) {
                        return cookieStore.get(name)?.value;
                    },
                },
            }
        );

        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { data: subscription, error: subError } = await supabase
            .from('subscriptions')
            .select('stripe_subscription_id')
            .eq('user_id', user.id)
            .eq('status', 'active')
            .single();

        if (subError || !subscription?.stripe_subscription_id) {
            return NextResponse.json({ error: 'No active subscription found' }, { status: 404 });
        }

        // Update the subscription to cancel at period end
        const updatedSubscription = await stripe.subscriptions.update(
            subscription.stripe_subscription_id,
            { cancel_at_period_end: true }
        );

        // Use type assertion
        type StripeSubscription = {
            id: string;
            current_period_end: number;
            status: string;
            cancel_at_period_end: boolean;
        };
        
        const subscriptionData = updatedSubscription as unknown as StripeSubscription;

        await supabase
            .from('subscriptions')
            .update({ 
                cancel_at_period_end: true,
                updated_at: new Date().toISOString()
            })
            .eq('stripe_subscription_id', subscription.stripe_subscription_id);

        return NextResponse.json({
            message: 'Subscription will be cancelled at period end',
            currentPeriodEnd: new Date(subscriptionData.current_period_end * 1000).toISOString()
        });

    } catch (error) {
        console.error('Cancellation failed:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return NextResponse.json(
            { error: 'Failed to cancel subscription', details: errorMessage },
            { status: 500 }
        );
    }
}