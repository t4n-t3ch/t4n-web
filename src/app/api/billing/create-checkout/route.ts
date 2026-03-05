import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function POST(req: NextRequest) {
    try {
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

        const { data: userData } = await supabase
            .from('users')
            .select('email')
            .eq('id', user.id)
            .single();

        const session = await stripe.checkout.sessions.create({
            customer_email: userData?.email,
            mode: 'subscription',
            line_items: [{
                price: process.env.STRIPE_PRICE_ID_STARTER,
                quantity: 1,
            }],
            success_url: `${process.env.FRONTEND_URL}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${process.env.FRONTEND_URL}/billing/cancel`,
            metadata: { userId: user.id },
            subscription_data: { metadata: { userId: user.id } },
        });

        return NextResponse.json({ url: session.url });
    } catch (error) {
        console.error('Checkout failed:', error);
        return NextResponse.json({ error: 'Failed to create checkout' }, { status: 500 });
    }
}