import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

// Define a type for the subscription data we need
type SubscriptionData = {
    id: string;
    current_period_start: number;
    current_period_end: number;
    status: string;
    cancel_at_period_end: boolean;
};

export async function GET(req: NextRequest) {
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

        // Get the authenticated user
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Get session_id from query params
        const sessionId = req.nextUrl.searchParams.get('session_id');
        
        if (!sessionId) {
            return NextResponse.json({ error: 'Session ID required' }, { status: 400 });
        }

        // Retrieve the checkout session from Stripe
        const session = await stripe.checkout.sessions.retrieve(sessionId, {
            expand: ['subscription', 'customer'],
        }) as Stripe.Checkout.Session;

        // Verify this session belongs to the authenticated user
        if (session.metadata?.userId !== user.id) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
        }

        if (session.payment_status === 'paid') {
            // Cast to our custom type instead of 'any'
            const subscription = session.subscription as unknown as SubscriptionData;
            
            if (!subscription) {
                return NextResponse.json({ error: 'No subscription found' }, { status: 400 });
            }

            // Update user's plan
            await supabase
                .from('users')
                .update({ 
                    plan: 'pro', 
                    stripe_customer_id: session.customer as string,
                    updated_at: new Date().toISOString()
                })
                .eq('id', user.id);

            // Create subscription record
            await supabase
                .from('subscriptions')
                .upsert({
                    user_id: user.id,
                    stripe_subscription_id: subscription.id,
                    stripe_customer_id: session.customer as string,
                    status: subscription.status,
                    plan_type: 'pro',
                    current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
                    current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
                    cancel_at_period_end: subscription.cancel_at_period_end,
                    updated_at: new Date().toISOString()
                }, {
                    onConflict: 'stripe_subscription_id'
                });

            return NextResponse.json({ 
                success: true, 
                upgraded: true,
                subscription: {
                    status: subscription.status,
                    currentPeriodEnd: new Date(subscription.current_period_end * 1000).toISOString()
                }
            });
        }

        return NextResponse.json({ 
            success: false, 
            upgraded: false,
            message: 'Payment not completed'
        });

    } catch (error) {
        console.error('Session verification failed:', error);
        return NextResponse.json(
            { error: 'Failed to verify session' },
            { status: 500 }
        );
    }
}