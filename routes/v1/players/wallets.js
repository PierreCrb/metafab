/*
 * Route: /players/:playerId/wallets
 */

const evmUtils = rootRequire('/libs/evmUtils');
const transactionUtils = rootRequire('/libs/transactionUtils');
const playerAuthorize = rootRequire('/middlewares/players/authorize');

const router = express.Router({
  mergeParams: true,
});

/**
 *  @openapi
 *  /v1/players/{playerId}/wallets:
 *    post:
 *      operationId: setPlayerConnectedWallet
 *      summary: Set player connected wallet
 *      description:
 *        Sets an external wallet as the wallet for a player account.
 *        The set wallet can transact gaslessly with all MetaFab
 *        related systems through the same MetaFab API calls as custodial wallets without
 *        requiring transaction signing or private keys.
 *
 *
 *        This is done through an internal system MetaFab has created
 *        that allows an external connected wallet to delegate transaction signing
 *        for a specific game's set of contracts to a player's password protected
 *        custodial wallet. This allow the custodial wallet to sign and submit
 *        transactions to a specific game's related contracts as if they were signed
 *        and submitted by the connected external wallet. This also means that all
 *        earned tokens, purchased items and any interactions happen and are recorded
 *        on chain as the external connected wallet. No additional logic needs to
 *        be writted by developers to support both custodial and external wallets,
 *        everything just works.
 *
 *
 *        Finally, this endpoint is meant for advanced users. The majority of developers
 *        who want to implement external wallet support for their game can do so without
 *        any extra work through our whitelabeled wallet connection feature that
 *        implements this endpoint underneath the hood without any required work.
 *      tags:
 *        - Players
 *      parameters:
 *        - $ref: '#/components/parameters/pathPlayerIdAuthenticated'
 *        - $ref: '#/components/parameters/headerAuthorizationPlayer'
 *      requestBody:
 *        required: true
 *        content:
 *          application/json:
 *            schema:
 *              type: object
 *              properties:
 *                address:
 *                  type: string
 *                  description:
 *                    The address of the external wallet to connect to the player.
 *                nonce:
 *                  type: integer
 *                  description:
 *                    Any positive integer that hasn't been used previously to connect
 *                    or disconnect this external wallet. Must be the same nonce used
 *                    to generate the `signature`.
 *                signature:
 *                  type: string
 *                  description:
 *                    A signature string generated by signing a keccak256 hash generated
 *                    with abiCoder encode arguments of `[ 'bytes32', 'address', 'bool', 'address', 'uint256' ]`
 *                    and `[ keccak256(gameId), delegate wallet approved (player's custodial wallet address), true, external wallet address, any unused nonce number ]`.
 *                chain:
 *                  type: string
 *                  description:
 *                    The blockchain you want to support this wallet connection on.
 *                    If you need to support multiple blockchains, make multiple requests
 *                    using different `chain` arguments.
 *                    Support for new blockchains are added over time.
 *                  example: SELECT ONE
 *                  enum: [ARBITRUM,ARBITRUMGOERLI,ARBITRUMNOVA,AVALANCHE,AVALANCHEFUJI,BINANCE,BINANCETESTNET,ETHEREUM,FANTOM,FANTOMTESTNET,GOERLI,MATIC,MATICMUMBAI,MOONBEAM,MOONBEAMTESTNET,THUNDERCORE,THUNDERCORETESTNET]
 *              required:
 *                - address
 *                - nonce
 *                - signature
 *                - chain
 *      responses:
 *        200:
 *          description:
 *            Successfully set the player's external wallet. Returns the connected
 *            wallet id and address, as well as connection transaction object.
 *          content:
 *            application/json:
 *              schema:
 *                type: object
 *                properties:
 *                  id:
 *                    type: string
 *                  address:
 *                    type: string
 *                  transaction:
 *                    $ref: '#/components/schemas/TransactionModel'
 *        400:
 *          $ref: '#/components/responses/400'
 *        401:
 *          $ref: '#/components/responses/401'
 */

router.post('/', playerAuthorize);
router.post('/', asyncMiddleware(async (request, response) => {
  const { player } = request;
  const { address, nonce, signature, chain } = request.body;

  if (!address || !nonce || !signature || !chain) {
    throw new Error('address, nonce, signature and chain must be provided.');
  }

  const game = await prisma.game.findUnique({
    where: { id: player.gameId },
    select: {
      id: true,
      rpcs: true,
      fundingWallet: true,
    },
  });

  const transaction = await transactionUtils.executeDelegateApprovalForSystemTransaction({
    systemId: evmUtils.hashMessage(game.id),
    delegateAddress: player.custodialWallet.address,
    approved: true,
    signerAddress: address,
    nonce,
    signature,
    fundingWalletCiphertext: game.fundingWallet.ciphertext,
    chain,
    rpcs: game.rpcs,
  });

  const updatedPlayer = await prisma.player.update({
    where: { id: player.id },
    data: {
      connectedWallet: {
        connectOrCreate: {
          where: { address },
          create: { address, ciphertext: '' },
        },
      },
    },
  });

  response.success({
    id: updatedPlayer.connectedWalletId,
    address,
    transaction,
  });
}));

/**
 *  @openapi
 *  /v1/players/{playerId}/wallets/{playerWalletId}:
 *    delete:
 *      operationId: removePlayerConnectedWallet
 *      summary: Remove player connected wallet
 *      description:
 *        Removes an external wallet from a player account.
 *        The player's wallet is reverted to their custodial wallet.
 *      tags:
 *        - Players
 *      parameters:
 *        - $ref: '#/components/parameters/pathPlayerId'
 *        - $ref: '#/components/parameters/pathPlayerWalletId'
 *      requestBody:
 *        required: true
 *        content:
 *          application/json:
 *            schema:
 *              type: object
 *              properties:
 *                address:
 *                  type: string
 *                  description:
 *                    The address of the external wallet to remove from a player.
 *                nonce:
 *                  type: integer
 *                  description:
 *                    Any positive integer that hasn't been used previously to connect
 *                    or disconnect this external wallet. Must be the same nonce used
 *                    to generate the `signature`.
 *                signature:
 *                  type: string
 *                  description:
 *                    A signature string generated by signing a keccak256 hash generated
 *                    with abiCoder encode arguments of `[ 'bytes32', 'address', 'bool', 'address', 'uint256' ]`
 *                    and `[ keccak256(gameId), delegate wallet unapproved (player's custodial wallet address), false, external wallet address, any unused nonce number ]`.
 *                chain:
 *                  type: string
 *                  description:
 *                    The blockchain you want to remove this wallet connection on.
 *                    If you need to remove it on multiple blockchains, make multiple requests
 *                    using different `chain` arguments.
 *                    Support for new blockchains are added over time.
 *                  example: SELECT ONE
 *                  enum: [ARBITRUM,ARBITRUMGOERLI,ARBITRUMNOVA,AVALANCHE,AVALANCHEFUJI,BINANCE,BINANCETESTNET,ETHEREUM,FANTOM,FANTOMTESTNET,GOERLI,MATIC,MATICMUMBAI,MOONBEAM,MOONBEAMTESTNET,THUNDERCORE,THUNDERCORETESTNET]
 *              required:
 *                - address
 *                - nonce
 *                - signature
 *                - chain
 *      responses:
 *        200:
 *          description:
 *            Successfully removed the player's external wallet. Returns an empty 200 response.
 *        400:
 *          $ref: '#/components/responses/400'
 *        401:
 *          $ref: '#/components/responses/401'
 */

router.delete('/:playerWalletId', playerAuthorize);
router.delete('/:playerWalletId', asyncMiddleware(async (request, response) => {
  const { player } = request;
  const { address, nonce, signature, chain } = request.body;

  if (!player.connectedWalletId) {
    throw new Error('No connected wallet to remove.');
  }

  if (!address || !nonce || !signature || !chain) {
    throw new Error('address, nonce, signature and chain must be provided.');
  }

  const game = await prisma.game.findUnique({
    where: { id: player.gameId },
    select: {
      id: true,
      rpcs: true,
      fundingWallet: true,
    },
  });

  await prisma.$transaction(async prismaTransaction => {
    await prismaTransaction.player.update({
      where: { id: player.id },
      data: {
        connectedWallet: { disconnect: true },
      },
    });

    await transactionUtils.executeDelegateApprovalForSystemTransaction({
      systemId: evmUtils.hashMessage(game.id),
      delegateAddress: player.custodialWallet.address,
      approved: false,
      signerAddress: address,
      nonce,
      signature,
      fundingWalletCiphertext: game.fundingWallet.ciphertext,
      chain,
      rpcs: game.rpcs,
    });
  });

  response.success();
}));

/*
 * Export
 */

module.exports = router;
