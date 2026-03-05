/* eslint-disable @typescript-eslint/no-unused-vars */
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

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

        const { data: userData } = await supabase
            .from('users')
            .select('stripe_customer_id')
            .eq('id', user.id)
            .single();

        if (!userData?.stripe_customer_id) {
            return NextResponse.json({ error: 'No subscription found' }, { status: 404 });
        }

        const session = await stripe.billingPortal.sessions.create({
            customer: userData.stripe_customer_id,
            return_url: `${process.env.FRONTEND_URL}/billing`,
        });

        return NextResponse.json({ url: session.url });
    } catch (error) {
        console.error('Portal creation failed:', error);
        return NextResponse.json({ error: 'Failed to create portal' }, { status: 500 });
    }
}