import {lookupArchive} from "@subsquid/archive-registry"
import * as ss58 from "@subsquid/ss58"
import {BatchContext, BatchProcessorItem, SubstrateBatchProcessor} from "@subsquid/substrate-processor"
import {Store, TypeormDatabase} from "@subsquid/typeorm-store"
import {In} from "typeorm"
import {Account, HistoricalBalance} from "./model"
import {BalancesTransferEvent} from "./types/events"


const processor = new SubstrateBatchProcessor()
    .setBatchSize(500)
    .setDataSource({
        // Lookup archive by the network name in the Subsquid registry
        // archive: lookupArchive("kusama", { release: "FireSquid" })

        // Use archive created by archive/docker-compose.yml
        archive: 'http://44.206.141.213:8888/graphql'
    })
    .addEvent('Balances.Transfer', {
        data: {event: {args: true}}
    } as const)


type Item = BatchProcessorItem<typeof processor>
type Ctx = BatchContext<Store, Item>


processor.run(new TypeormDatabase(), async ctx => {
    let transfers = getTransfers(ctx)

    let accountIds = new Set<string>()
    for (let t of transfers) {
        accountIds.add(t.from)
        accountIds.add(t.to)
    }

    let accounts = await ctx.store.findBy(Account, {id: In([...accountIds])}).then(accounts => {
        return new Map(accounts.map(a => [a.id, a]))
    })

    let history: HistoricalBalance[] = []

    for (let t of transfers) {
        let from = getAccount(accounts, t.from)
        let to = getAccount(accounts, t.to)

        from.balance -= t.amount
        to.balance += t.amount

        history.push(new HistoricalBalance({
            id: t.id + "-from",
            account: from,
            balance: from.balance,
            timestamp: t.timestamp
        }))

        history.push(new HistoricalBalance({
            id: t.id + "-to",
            account: to,
            balance: to.balance,
            timestamp: t.timestamp
        }))
    }

    await ctx.store.save(Array.from(accounts.values()))
    await ctx.store.insert(history)
})


interface TransferEvent {
    id: string
    from: string
    to: string
    amount: bigint
    timestamp: bigint
}


function getTransfers(ctx: Ctx): TransferEvent[] {
    let transfers: TransferEvent[] = []
    for (let block of ctx.blocks) {
        for (let item of block.items) {
            if (item.name == "Balances.Transfer") {
                let e = new BalancesTransferEvent(ctx, item.event)
                let rec: {from: Uint8Array, to: Uint8Array, amount: bigint}
                if (e.isV1) {
                    let [from, to, amount] = e.asV1
                    rec = {from, to, amount}
                } else {
                    continue
                }
                transfers.push({
                    id: item.event.id,
                    from: ss58.codec('kusama').encode(rec.from),
                    to: ss58.codec('kusama').encode(rec.to),
                    amount: rec.amount,
                    timestamp: BigInt(block.header.timestamp)
                })
            }
        }
    }
    return transfers
}


function getAccount(m: Map<string, Account>, id: string): Account {
    let acc = m.get(id)
    if (acc == null) {
        acc = new Account()
        acc.id = id
        acc.balance = 0n
        m.set(id, acc)
    }
    return acc
}
