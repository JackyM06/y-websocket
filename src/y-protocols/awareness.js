/**
 * @module awareness-protocol
 */

import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import * as time from 'lib0/time'
import * as math from 'lib0/math'
import { Observable } from 'lib0/observable'
import * as f from 'lib0/function'
import * as Y from 'yjs' // eslint-disable-line

export const outdatedTimeout = 30000

/**
 * @typedef {Object} MetaClientState
 * @property {number} MetaClientState.clock
 * @property {number} MetaClientState.lastUpdated unix timestamp
 */

/**
 * The Awareness class implements a simple shared state protocol that can be used for non-persistent data like awareness information
 * (cursor, username, status, ..). Each client can update its own local state and listen to state changes of
 * remote clients. Every client may set a state of a remote peer to `null` to mark the client as offline.
 *
 * Each client is identified by a unique client id (something we borrow from `doc.clientID`). A client can override
 * its own state by propagating a message with an increasing timestamp (`clock`). If such a message is received, it is
 * applied if the known state of that client is older than the new state (`clock < newClock`). If a client thinks that
 * a remote client is offline, it may propagate a message with
 * `{ clock: currentClientClock, state: null, client: remoteClient }`. If such a
 * message is received, and the known clock of that client equals the received clock, it will override the state with `null`.
 *
 * Before a client disconnects, it should propagate a `null` state with an updated clock.
 *
 * Awareness states must be updated every 30 seconds. Otherwise the Awareness instance will delete the client state.
 *
 * @extends {Observable<string>}
 */
export class Awareness extends Observable {
    /**
     * @param {Y.Doc} doc
     */
    constructor(doc) {
        super()
        this.doc = doc
        /**
         * @type {number}
         */
        this.clientID = doc.clientID
        /**
         * Maps from client id to client state
         * @type {Map<number, Object<string, any>>}
         */
        this.states = new Map()
        /**
         * @type {Map<number, MetaClientState>}
         */
        this.meta = new Map() // Meta具体干啥的，还不清楚
        // 这是一个agent在线状态检查器， 每个周期检查10次，一个周期30秒， 每半个周期会更新并告知其他agent自己的在线状态
        this._checkInterval = /** @type {any} */ (setInterval(() => {
            const now = time.getUnixTime()

            // 判定条件，如果当前已经链接，并且 更新时间30秒 / 2 <= 当前时间 - 当前联机链接的最后更新时间
            if (this.getLocalState() !== null && (outdatedTimeout / 2 <= now - /** @type {{lastUpdated:number}} */ (this.meta.get(this.clientID)).lastUpdated)) {
                // renew local clock
                // 更新一下当前联机的最后更新时间， 会通知给其他的agent
                this.setLocalState(this.getLocalState())
            }
            /**
             * @type {Array<number>}
             */
            const remove = []
            this.meta.forEach((meta, clientid) => {
                // 标记下，其他连接的agent里，更新时间超过30秒的
                if (clientid !== this.clientID && outdatedTimeout <= now - meta.lastUpdated && this.states.has(clientid)) {
                    remove.push(clientid)
                }
            })
            if (remove.length > 0) {
                // 删除掉刚刚标记的agent, 并且需要通知到其他的agent
                removeAwarenessStates(this, remove, 'timeout')
            }
        }, math.floor(outdatedTimeout / 10)))
        // 销毁之后，定时器自动关闭
        doc.on('destroy', () => {
            this.destroy()
        })
        // 初始化一下当前agent的state
        this.setLocalState({})
    }

    destroy() {
        // 清掉！清掉！统统清掉
        this.emit('destroy', [ this ])
        this.setLocalState(null)
        super.destroy()
        clearInterval(this._checkInterval)
    }

    /**
     * @return {Object<string,any>|null}
     */
    getLocalState() {
        return this.states.get(this.clientID) || null
    }

    /**
     * @param {Object<string,any>|null} state
     */
    setLocalState(state) {
        const clientID = this.clientID
        const currLocalMeta = this.meta.get(clientID)
        // meta里面会记录一个clock， 默认从0开始，每次更新state的时候递增
        const clock = currLocalMeta === undefined ? 0 : currLocalMeta.clock + 1
        // 在更新之后，取出旧的state
        const prevState = this.states.get(clientID)
        if (state === null) {
            // 为Null的时候，直接删除这个agent state.这样就不用记一大堆垃圾client: null了
            this.states.delete(clientID)
        } else {
            this.states.set(clientID, state)
        }
        // 更新下meta： clock + 1， lastUpdated时间更新下
        this.meta.set(clientID, {
            clock,
            lastUpdated: time.getUnixTime()
        })

        // 标记下当前state是怎么性质的
        const added = []  // 添加的state
        const updated = [] // 更新的state，（这个更新可能不是实际更新）
        const filteredUpdated = [] //实际更新了（通过equalityDeep进行深度对比）的state 
        const removed = [] // 删除的state
        if (state === null) {
            removed.push(clientID)
        } else if (prevState == null) {
            if (state != null) {
                added.push(clientID)
            }
        } else {
            updated.push(clientID)
            if (!f.equalityDeep(prevState, state)) {
                filteredUpdated.push(clientID)
            }
        }
        if (added.length > 0 || filteredUpdated.length > 0 || removed.length > 0) {
            // 如果有具体的state增删改，那么会触发一下change
            this.emit('change', [ { added, updated: filteredUpdated, removed }, 'local' ])
        }
        // update是一定会触发的
        this.emit('update', [ { added, updated, removed }, 'local' ])
    }

    /**
     * @param {string} field
     * @param {any} value
     */
    setLocalStateField(field, value) {
        const state = this.getLocalState()
        if (state !== null) {
            this.setLocalState({
                ...state,
                [ field ]: value
            })
        }
    }

    /**
     * @return {Map<number,Object<string,any>>}
     */
    getStates() {
        return this.states
    }
}

/**
 * Mark (remote) clients as inactive and remove them from the list of active peers.
 * This change will be propagated to remote clients.
 *
 * @param {Awareness} awareness
 * @param {Array<number>} clients
 * @param {any} origin
 */
export const removeAwarenessStates = (awareness, clients, origin) => {
    // 批量的删除一些states
    const removed = []
    for (let i = 0; i < clients.length; i++) {
        const clientID = clients[ i ]

        if (awareness.states.has(clientID)) {
            // 直接开始删，本地的删完
            awareness.states.delete(clientID)
            if (clientID === awareness.clientID) {
                // 如果不小心删到自己了，那就做个特殊处理
                const curMeta = /** @type {MetaClientState} */ (awareness.meta.get(clientID))
                // 更新一下自己的clock和loatUpdated
                awareness.meta.set(clientID, {
                    clock: curMeta.clock + 1,
                    lastUpdated: time.getUnixTime()
                })
            }
            removed.push(clientID)
        }
    }
    if (removed.length > 0) {
        // 把删除信息推送到全局
        awareness.emit('change', [ { added: [], updated: [], removed }, origin ])
        awareness.emit('update', [ { added: [], updated: [], removed }, origin ])
    }
}

/**
 * 把states数据统一写成二进制，便于网络供应商进行传输
 * @param {Awareness} awareness 指定感知信息存储对象
 * @param {Array<number>} clients 要将本地哪些client的state广播到远端
 * @return {Uint8Array}
 */
export const encodeAwarenessUpdate = (awareness, clients, states = awareness.states) => {
    const len = clients.length
    const encoder = encoding.createEncoder()

    /** 
     * 二进制格式：
     * 
     * clients的数量,
     * 
     * clientID1,
     * clock,
     * state
     * 
     * clientID2,
     * clock,
     * state
     * ...
    */

    encoding.writeVarUint(encoder, len)
    for (let i = 0; i < len; i++) {
        const clientID = clients[ i ]
        const state = states.get(clientID) || null
        const clock = /** @type {MetaClientState} */ (awareness.meta.get(clientID)).clock
        encoding.writeVarUint(encoder, clientID)
        encoding.writeVarUint(encoder, clock)
        encoding.writeVarString(encoder, JSON.stringify(state))
    }
    return encoding.toUint8Array(encoder)
}

/**
 * Modify the content of an awareness update before re-encoding it to an awareness update.
 *
 * This might be useful when you have a central server that wants to ensure that clients
 * cant hijack somebody elses identity.
 *
 * 这块是一个重编码的逻辑，update是个二进制数据包，这个方法会把数据送update中解析出来，重新用modify方法改写一遍数据中的state，然后再按
 * encodeAwarenessUpdate的格式组成二进制。
 * 
 * 这个方法作用应该是数据中的state在发送前能再精简一些， modify方式应该是个diff函数，需要重点看下
 * 
 * @param {Uint8Array} update
 * @param {function(any):any} modify
 * @return {Uint8Array}
 */
export const modifyAwarenessUpdate = (update, modify) => {
    const decoder = decoding.createDecoder(update)
    const encoder = encoding.createEncoder()
    const len = decoding.readVarUint(decoder)
    encoding.writeVarUint(encoder, len)
    for (let i = 0; i < len; i++) {
        const clientID = decoding.readVarUint(decoder)
        const clock = decoding.readVarUint(decoder)
        const state = JSON.parse(decoding.readVarString(decoder))
        const modifiedState = modify(state) // 重写了下state
        encoding.writeVarUint(encoder, clientID)
        encoding.writeVarUint(encoder, clock)
        encoding.writeVarString(encoder, JSON.stringify(modifiedState))
    }
    return encoding.toUint8Array(encoder)
}

/**
 * 接收方用此方法，将二进制数据包，解析为原来的clientId、clock、state， 并且对数据进行再次加工
 * @param {Awareness} awareness 感知数据对象
 * @param {Uint8Array} update 二进制数据包
 * @param {any} origin This will be added to the emitted change event
 */
export const applyAwarenessUpdate = (awareness, update, origin) => {
    // 解码器
    const decoder = decoding.createDecoder(update)
    const timestamp = time.getUnixTime() // 当前的一个时间戳
    const added = [] // 添加的state，（误，不是标state, 而是标clientID）
    const updated = [] // 所有state
    const filteredUpdated = [] // 发生变更的state
    const removed = [] // 删除的state
    const len = decoding.readVarUint(decoder)  // 把要改动的client 数量解析出来，后面进入循环
    for (let i = 0; i < len; i++) {
        const clientID = decoding.readVarUint(decoder) // 把client ID解出来
        let clock = decoding.readVarUint(decoder) // 把clock解出来，感觉这个clock后面应该有大用
        const state = JSON.parse(decoding.readVarString(decoder)) // 把state解出来，注意这里可能是被modify的lite版数据
        const clientMeta = awareness.meta.get(clientID) // 把本地的meta（clock、lastUpdated）取出来
        const prevState = awareness.states.get(clientID) // 把本地的state取出来
        const currClock = clientMeta === undefined ? 0 : clientMeta.clock

        // 进入本地clock和更新下来的clock的对比环节
        // 如果本地的clock和远程的clock小，那就以远程的state为准，该删删删，该改改改
        if (currClock < clock || (currClock === clock && state === null && awareness.states.has(clientID))) {
            if (state === null) {
                // never let a remote client remove this local state
                if (clientID === awareness.clientID && awareness.getLocalState() != null) {
                    // remote client removed the local state. Do not remote state. Broadcast a message indicating
                    // that this client still exists by increasing the clock
                    clock++
                } else {
                    awareness.states.delete(clientID)
                }
            } else {
                awareness.states.set(clientID, state)
            }
            // 更新下meta
            awareness.meta.set(clientID, {
                clock,
                lastUpdated: timestamp
            })
            if (clientMeta === undefined && state !== null) {
                // meta为空、state有值的情况下，判定这个agent是新增的
                added.push(clientID)
            } else if (clientMeta !== undefined && state === null) {
                // meta有值、state为空的情况下，判定这个agent是来删除的
                removed.push(clientID)
            } else if (state !== null) {
                if (!f.equalityDeep(state, prevState)) {
                    // 真 - 修改的agent
                    filteredUpdated.push(clientID)
                }
                // 默认修改的agent
                updated.push(clientID)
            }
        }
    }
    if (added.length > 0 || filteredUpdated.length > 0 || removed.length > 0) {
        // 照例触发下change和update事件
        awareness.emit('change', [ {
            added, updated: filteredUpdated, removed
        }, origin ])
    }
    if (added.length > 0 || updated.length > 0 || removed.length > 0) {
        awareness.emit('update', [ {
            added, updated, removed
        }, origin ])
    }
}
