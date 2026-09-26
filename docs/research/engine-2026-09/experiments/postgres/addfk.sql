ALTER TABLE ONLY public.clob_fills
    ADD CONSTRAINT clob_fills_maker_order_id_fkey FOREIGN KEY (maker_order_id) REFERENCES public.clob_orders(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.clob_fills
    ADD CONSTRAINT clob_fills_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.clob_fills
    ADD CONSTRAINT clob_fills_market_option_id_fkey FOREIGN KEY (market_option_id) REFERENCES public.market_options(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.clob_fills
    ADD CONSTRAINT clob_fills_taker_order_id_fkey FOREIGN KEY (taker_order_id) REFERENCES public.clob_orders(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.clob_orders
    ADD CONSTRAINT clob_orders_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.clob_orders
    ADD CONSTRAINT clob_orders_market_option_id_fkey FOREIGN KEY (market_option_id) REFERENCES public.market_options(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.clob_orders
    ADD CONSTRAINT clob_orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.clob_orders
    ADD CONSTRAINT clob_orders_wallet_id_fkey FOREIGN KEY (wallet_id) REFERENCES public.wallets(id);
ALTER TABLE ONLY public.positions
    ADD CONSTRAINT positions_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id);
ALTER TABLE ONLY public.positions
    ADD CONSTRAINT positions_market_option_id_fkey FOREIGN KEY (market_option_id) REFERENCES public.market_options(id);
ALTER TABLE ONLY public.positions
    ADD CONSTRAINT positions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id);
ALTER TABLE ONLY public.positions
    ADD CONSTRAINT positions_wallet_id_fkey FOREIGN KEY (wallet_id) REFERENCES public.wallets(id);
ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id);
ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_market_option_id_fkey FOREIGN KEY (market_option_id) REFERENCES public.market_options(id);
ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id);
ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id);
ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_wallet_id_fkey FOREIGN KEY (wallet_id) REFERENCES public.wallets(id);
