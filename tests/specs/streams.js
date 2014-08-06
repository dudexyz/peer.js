define([
	'models/stream',
	'models/localmedia',
	'utils/events'
], function(Streams, LocalMedia, Events){

	var peers = {};

	var Peer = function(id){

		// Simulate the peer object
		var peer = new Events();

		// Set defaults
		peer.stun_server = "stun:localhost";

		// Give it an ID
		peer.id = id;

		// Peer needs the send method
		peer.send = function(name, data, callback){
			data.from = id;
			if( data.to && data.to in peers ){
				peers[data.to].emit(data.type, data);
			}
		};

		// Bind threads to it.
		Streams.call(peer);

		// Bind threads to it.
		LocalMedia.call(peer);

		peers[id] = peer;

		return peer;
	};



	describe("models/streams", function(){

		this.timeout(5000);

		var peer;

		afterEach(function(){

			// Close all the current peer connections
			for(var id in peers){
				var peer = peers[id];
				peer.events = {};
				for( var _id in peer.streams ){
					peer.streams[_id].pc.close();
					if(peer.streams[_id].channel)
						peer.streams[_id].channel.close();
				}
				peers.streams = {};
			}

			peers = {};
		});


		it("should extend the peer object with streams (Hash) and stream (Method)", function(){


			// Simulate the peer object
			var peer = Peer(1);

			// Threads collection

			expect(peer).to.have.property('streams');
			expect(peer.streams).to.be.an(Object);


			// Threads function for augmenting

			expect(peer).to.have.property('stream');
			expect(peer.stream).to.be.a(Function);

		});

		it("should trigger stream on 'stream:connect', 'stream:change', 'stream:change'", function(){

			// Simulate the peer object
			var peer = Peer(1);

			var spy = sinon.spy();
			peer.stream = spy;

			['stream:connect', 'stream:change', 'stream:change', 'stream:offer', 'stream:makeoffer'].forEach(function(event_name){
				spy.reset();
				peer.emit(event_name);
				expect( spy.calledOnce ).to.be.ok();
			});

		});


		it("should send a stream:offer to peerA, when peerB calls stream( 'A' ), peerA should then respond with stream:answer", function(done){

			var peerA = Peer('A');
			var peerB = Peer('B');

			var spy = sinon.spy(function(data){
				expect( data ).to.have.property('data');
				expect( data.data ).to.have.property('sdp');
				expect( data.data ).to.have.property('type', 'offer');
			});

			// Should trigger a stream:offer event
			peerA.on('stream:offer', spy);

			peerB.on('stream:answer', function(data){

				expect( spy.calledOnce ).to.be.ok();

				expect( data ).to.be.property('data');
				expect( data.data ).to.have.property('sdp');
				expect( data.data ).to.have.property('type', 'answer');
				done();
			});

			// Creating a peer stream
			peerB.stream( 'A', {} );
		});

		it("should respect who is master, and send a stream:makeoffer to peerB, when peerA makes the same call, (a master is determined by 'B' < 'A')", function(done){

			var peerA = Peer('A');
			var peerB = Peer('B');

			// Should trigger a stream:offer event
			var spyOffer = sinon.spy();
			var spyMakeOffer = sinon.spy();

			// Peer A should never receive an offer
			peerB.on('stream:offer', spyOffer );

			// Peer A shall receive a request to make the offer
			peerB.on('stream:makeoffer', spyMakeOffer );

			// Peer B should still receive an offer
			peerA.on('stream:offer',function(data){

				expect( spyOffer.notCalled ).to.be.ok();

				expect( spyMakeOffer.called ).to.be.ok();

				expect( data ).to.have.property('data');
				expect( data.data ).to.have.property('sdp');
				expect( data.data ).to.have.property('type', 'offer');

				done();
			});

			// Creating a peer stream
			peerA.stream( 'B', {} );

		});


		it("should trigger renegotiation from either party", function(done){

			var spy = sinon.spy();

			/**
			Either client needs to be able to trigger renegotiations of the setup
			*/

			var peerA = Peer('A');
			var peerB = Peer('B');

			// Signalling state is stable when Peer B (MASTER) receives the stream:answer back from the Peer A (SLAVE)
			peerB.one('stream:answer',function(data){

				// Slave should ultimatly receive a stream:offer
				peerA.one('stream:offer', function(){
					done();
				});

				// Now lets trigger a renegotiation from the Slave to its master
				// And listen for a makeoffer event
				peerB.one('stream:makeoffer', spy );
				peerA.streams['B'].pc.onnegotiationneeded();

				// This will retrigger a stream:makeoffer event from Slave to Master
				expect( spy.calledOnce ).to.be.ok();
			});

			// Creating a peer stream
			peerA.stream( 'B', {} );

		});


		describe("channel messaging", function(){

			it("should trigger channel:connect when it is established during stream connection", function(done){

				var peerA = Peer('A');
				var peerB = Peer('B');

				// Creating a peer stream
				peerB.stream( 'A', {} );

				var spy = sinon.spy(function(data){
					expect(data).to.have.property('type', 'channel:connect');
					done();
				});

				peerB.on('channel:connect', spy);

			});


			it("should extend peer.send to send messages between peers", function(done){

				var peerA = Peer('A');
				var peerB = Peer('B');

				// Creating a peer stream
				peerB.stream( 'A', {} );

				peerB.on('channel:connect', function(){
					// Is capable of sending messages to another peer
					peerB.send({to:'A', type:'hello'});
				});
				peerA.on('channel:message', function(data){

					// Received message from
					expect(data).to.have.property('type', 'hello');

					done();
				});
			});

			it("should maintain connection regardless of being redefined by master", function(done){

				var peerA = Peer('A');
				var peerB = Peer('B');

				// Creating a peer stream
				peerA.stream( 'B', {} );

				peerA.on('channel:connect', function(){

					// Is capable of sending messages to another peer
					peerA.send({to:'B', type:'hello'});
				});
				peerB.on('channel:message', function(data){

					// Received message from
					expect(data).to.have.property('type', 'hello');

					done();
				});

			});
		});

		describe("video messaging", function(){

			it("should trigger localmedia:connect when getUserMedia is initiated via addMedia", function(done){

				// Give the user 10 seconds to tick any dialogue
				// Howver run this through an https server or open the browser with flags 
				this.timeout(10000);


				var peerA = Peer('A');
				var spy = sinon.spy();

				peerA.addMedia(spy);

				peerA.on('localmedia:connect', function(stream){
					expect(spy.calledOnce).to.be.ok();
					expect(stream).to.be.an(Object);
					done();
				});

			});

			it("should trigger media:connect when a peer shares a video with another", function(done){

				var peerA = Peer('A');

				var peerB = Peer('B');
				peerB.addMedia();

				peerA.on('media:connect', function(stream){
					console.log(stream);
					done();
				});
				peerB.stream('A', {local:{video:true},remote:{video:true}});
				peerA.stream('B', {local:{video:true},remote:{video:true}});

			});

		});

	});

});